require("dotenv").config();

const axios = require("axios");
const cheerio = require("cheerio");
const { google } = require("googleapis");
const { createClient } = require("@supabase/supabase-js");
const { ImapFlow } = require("imapflow");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const DEBUG = process.env.DEBUG === "true";
const ENABLE_TEST_SENDERS = process.env.ENABLE_TEST_SENDERS === "true";

function debugLog(...args) {
  if (DEBUG) console.log(...args);
}

function normalizeRetailerName(retailer) {
  const value = String(retailer || "").trim().toLowerCase();

  if (value === "pokemoncenter" || value === "pokemon center") {
    return "Pokemon Center";
  }
  if (value === "target") return "Target";
  if (value === "walmart") return "Walmart";

  return retailer || "Unknown Retailer";
}

const RETAILER_SENDERS = {
  Target: ["target.com", "oe1.target.com", "oe.target.com"],
  Walmart: ["walmart.com", "ib.transaction.walmart.com"],
  PokemonCenter: ["em.pokemon.com", "pokemon.com"],
  ...(ENABLE_TEST_SENDERS
    ? { Test: ["lensoflock@gmail.com", "babylock23@gmail.com"] }
    : {}),
};

const COLLECTIBLE_KEYWORDS = [
  "pokemon",
  "pokémon",
  "pokemon tcg",
  "pokemon trading card game",
  "one piece",
  "lorcana",
  "yugioh",
  "yu-gi-oh",
  "magic the gathering",
  "mtg",
  "sports card",
  "sports cards",
  "trading card",
  "trading cards",
  "tcg",
  "booster",
  "booster box",
  "booster bundle",
  "elite trainer box",
  "etb",
  "blaster",
  "mega box",
  "hobby box",
  "tin",
  "collection box",
  "starter deck",
  "bundle",
  "sealed box",
  "pack",
  "packs",
  "box set",
  "charizard",
  "ultra-premium collection",
  "premium collection",
  "poster collection",
  "upc",
  "151",
  "prismatic evolutions",
  "surging sparks",
  "crown zenith",
  "paldean fates",
  "twilight masquerade",
  "obsidian flames",
];

const NON_COLLECTIBLE_BLOCKLIST = [
  "milk",
  "bread",
  "banana",
  "bananas",
  "apple",
  "apples",
  "grocery",
  "groceries",
  "detergent",
  "paper towels",
  "toilet paper",
  "trash bags",
  "dish soap",
  "dog food",
  "cat food",
  "laundry",
  "shampoo",
  "conditioner",
  "toothpaste",
  "cleaner",
  "cleaning supplies",
  "vitamin",
  "supplement",
  "protein powder",
  "socks",
  "underwear",
  "toothbrush",
  "soap",
  "wipes",
  "flushable",
];

const SENSITIVE_PATTERNS = [
  "billing",
  "shipping address",
  "delivery address",
  "payment method",
  "visa",
  "mastercard",
  "amex",
  "discover",
  "card ending",
  "ending in",
  "last 4",
  "last four",
  "customer",
  "account",
  "@",
  "street",
  "avenue",
  "road",
  "boulevard",
  "lane",
  "zip",
  "postal code",
  "phone",
  "mobile",
  "apple pay",
  "google pay",
  "paypal",
  "delivers to",
  "rate & review",
  "write a review",
  "estimated taxes",
  "sales tax",
];

function normalizeText(value) {
  return (value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function includesAny(text, words) {
  const normalized = normalizeText(text);
  return words.some((word) => normalized.includes(word.toLowerCase()));
}

function decodeBase64Url(data) {
  if (!data) return "";
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf8");
}

function decodeQuotedPrintable(str) {
  if (!str) return "";

  const cleaned = str.replace(/=\r?\n/g, "");
  const bytes = [];

  for (let i = 0; i < cleaned.length; i++) {
    if (
      cleaned[i] === "=" &&
      i + 2 < cleaned.length &&
      /[A-Fa-f0-9]{2}/.test(cleaned.slice(i + 1, i + 3))
    ) {
      bytes.push(parseInt(cleaned.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(cleaned.charCodeAt(i));
    }
  }

  try {
    return Buffer.from(bytes).toString("utf8");
  } catch {
    return cleaned;
  }
}

function extractHeader(headers, name) {
  return (
    headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ||
    ""
  );
}

function flattenParts(parts = []) {
  let all = [];
  for (const part of parts) {
    all.push(part);
    if (part.parts?.length) {
      all = all.concat(flattenParts(part.parts));
    }
  }
  return all;
}

function extractBodyText(payload) {
  if (!payload) return "";

  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  const allParts = flattenParts(payload.parts || []);
  const textPlain =
    allParts.find((p) => p.mimeType === "text/plain" && p.body?.data) || null;
  if (textPlain?.body?.data) return decodeBase64Url(textPlain.body.data);

  const textHtml =
    allParts.find((p) => p.mimeType === "text/html" && p.body?.data) || null;
  if (textHtml?.body?.data) return decodeBase64Url(textHtml.body.data);

  return "";
}

function stripHtmlPreserveLines(html) {
  return (html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(
      /<\/(p|div|li|tr|h1|h2|h3|h4|h5|h6|table|tbody|tr|td|span)>/gi,
      "\n"
    )
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeMultilineText(text) {
  return (text || "")
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanCandidateLine(line) {
  return (line || "")
    .replace(/\s+/g, " ")
    .replace(/^[•\-*]\s*/, "")
    .trim();
}

function isUrlOnlyLine(line) {
  return /^https?:\/\/\S+$/i.test((line || "").trim());
}

function isImageUrlLine(line) {
  return /^https?:\/\/\S+\.(jpg|jpeg|png|webp)$/i.test((line || "").trim());
}

function isSensitiveLine(line) {
  const normalized = normalizeText(line);
  if (!normalized) return true;
  if (includesAny(normalized, SENSITIVE_PATTERNS)) return true;
  if (/@/.test(normalized)) return true;
  if (
    /\b(order|invoice|confirmation)\b/.test(normalized) &&
    /\d{3,}/.test(normalized)
  ) {
    return true;
  }
  return false;
}

function sanitizeCandidate(line) {
  const cleaned = cleanCandidateLine(line);
  const normalized = normalizeText(cleaned);

  if (!cleaned) return null;
  if (cleaned.length < 8 || cleaned.length > 240) return null;
  if (isUrlOnlyLine(cleaned)) return null;
  if (isImageUrlLine(cleaned)) return null;
  if (includesAny(normalized, NON_COLLECTIBLE_BLOCKLIST)) return null;
  if (
    isSensitiveLine(cleaned) &&
    !includesAny(cleaned, COLLECTIBLE_KEYWORDS)
  ) {
    return null;
  }

  return cleaned;
}

function cleanProductName(name) {
  if (!name) return name;
  return name
    .replace(/\s*-\s*\d+\s*cards?\s*$/i, "")
    .replace(/\s*qty[: ]*\d+\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractLinks(text) {
  return text.match(/https?:\/\/[^\s)"'>]+/gi) || [];
}

function cleanTargetUrl(url) {
  try {
    const parsed = new URL(url);

    if (parsed.searchParams.has("url")) {
      return decodeURIComponent(parsed.searchParams.get("url"));
    }

    if (parsed.searchParams.has("u")) {
      return decodeURIComponent(parsed.searchParams.get("u"));
    }

    return url;
  } catch {
    return url;
  }
}

function pickBestProductLink(retailer, rawBody) {
  const allLinks = extractLinks(rawBody);
  const nonImageLinks = allLinks.filter(
    (link) => !/\.(jpg|jpeg|png|webp)$/i.test(link)
  );

  if (retailer === "Target") {
    const cleanedLinks = nonImageLinks.map(cleanTargetUrl);
    const targetProductLink =
      cleanedLinks.find((link) => /target\.com\/p\//i.test(link)) ||
      cleanedLinks.find((link) => /\/p\//i.test(link));
    return targetProductLink || null;
  }

  if (retailer === "Walmart") {
    const walmartProductLink =
      nonImageLinks.find((link) => /walmart\.com\/ip\//i.test(link)) ||
      nonImageLinks.find((link) => /walmart\.com/i.test(link));
    return walmartProductLink || null;
  }

  if (retailer === "Pokemon Center" || retailer === "PokemonCenter") {
    return (
      nonImageLinks.find((link) => /pokemoncenter\.com/i.test(link)) || null
    );
  }

  return nonImageLinks[0] || null;
}

async function fetchProductMeta(url) {
  if (!url) return {};

  try {
    const { data } = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "text/html,application/xhtml+xml",
      },
      timeout: 5000,
      maxRedirects: 5,
    });

    const $ = cheerio.load(data);

    const image =
      $('meta[property="og:image"]').attr("content") ||
      $('meta[name="og:image"]').attr("content") ||
      $('meta[property="twitter:image"]').attr("content") ||
      null;

    const title =
      $('meta[property="og:title"]').attr("content") ||
      $("title").text()?.trim() ||
      null;

    return { image, title };
  } catch (err) {
    console.error("Meta fetch failed:", err.message);
    return {};
  }
}

function extractQuantity(text) {
  const patterns = [
    /quantity[: ]+(\d{1,3})/i,
    /qty[: ]+(\d{1,3})/i,
    /\bqty\b[^\d]{0,5}(\d{1,3})/i,
    /\b(\d+)\s*items?\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Number(match[1]);
  }
  return 1;
}

function extractPrice(text) {
  const match = text.match(/\$ ?(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/);
  if (!match) return null;
  return Number(match[1].replace(/,/g, ""));
}

function formatMoney(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function formatDateTime(value) {
  return new Date(value || new Date()).toLocaleString();
}

function detectRetailer(fromHeader, subject, bodyText) {
  const combined = `${fromHeader} ${subject} ${bodyText}`.toLowerCase();

  if (combined.includes("target")) return "Target";
  if (combined.includes("walmart")) return "Walmart";
  if (
    combined.includes("pokemon center") ||
    combined.includes("pokemoncenter.com") ||
    combined.includes("em.pokemon.com")
  ) {
    return "PokemonCenter";
  }

  return null;
}

function senderMatchesRetailer(retailer, fromHeader) {
  const sender = String(fromHeader || "").toLowerCase();
  const emailMatch = sender.match(/<([^>]+)>/);
  const cleanEmail = emailMatch ? emailMatch[1] : sender;

  const allowed = (RETAILER_SENDERS[retailer] || []).map((value) =>
    String(value).toLowerCase()
  );

  return allowed.some((domain) => cleanEmail.includes(domain));
}

function isShippingOrTrackingEmail(retailer, subject, bodyText) {
  const subjectText = (subject || "").toLowerCase();
  const body = (bodyText || "").toLowerCase();
  const combined = `${subjectText} ${body}`;

  if (retailer === "Target") {
    const targetConfirmationSubjectSignals = [
      "thanks for shopping with us",
      "thanks for your order",
      "thank you for your order",
      "here's your order",
      "here’s your order",
    ];

    const targetShippingSubjectSignals = [
      "are about to ship",
      "get ready for something special",
      "has shipped",
      "shipping confirmation",
      "tracking",
      "track status",
      "track package",
    ];

    const isTargetConfirmationSubject =
      targetConfirmationSubjectSignals.some((signal) =>
        subjectText.includes(signal)
      );

    const isTargetShippingSubject = targetShippingSubjectSignals.some((signal) =>
      subjectText.includes(signal)
    );

    if (isTargetConfirmationSubject) return false;
    if (isTargetShippingSubject) return true;
  }

  const commonShippingSignals = [
    "about to ship",
    "getting ready to ship",
    "shipping label has been created",
    "tracking number",
    "tracking #",
    "track package",
    "track your package",
    "track status",
    "shipment",
    "shipped",
    "shipping confirmation",
    "your order has shipped",
    "tracking information",
  ];

  if (commonShippingSignals.some((signal) => combined.includes(signal))) {
    return true;
  }

  if (retailer === "Walmart") {
    const walmartShippingSignals = [
      "delivery update",
      "your items are on the way",
      "has shipped",
    ];

    if (walmartShippingSignals.some((signal) => combined.includes(signal))) {
      return true;
    }
  }

  if (retailer === "PokemonCenter") {
    const pokemonShippingSignals = [
      "shipping confirmation",
      "tracking information",
      "has shipped",
      "your order has shipped",
    ];

    if (pokemonShippingSignals.some((signal) => combined.includes(signal))) {
      return true;
    }
  }

  return false;
}

function isInitialOrderConfirmation(retailer, subject, bodyText) {
  const normalizedSubject = (subject || "").toLowerCase();
  const combined = `${subject} ${bodyText}`.toLowerCase();

  if (retailer === "Target") {
    const targetConfirmationSubjectSignals = [
      "thanks for shopping with us",
      "thanks for your order",
      "thank you for your order",
      "here's your order",
      "here’s your order",
    ];
    return targetConfirmationSubjectSignals.some((signal) =>
      normalizedSubject.includes(signal)
    );
  }

  if (retailer === "Walmart") {
    const walmartConfirmationSignals = [
      "thanks for your delivery order",
      "thanks for your order",
      "order total",
    ];
    return walmartConfirmationSignals.some((signal) =>
      combined.includes(signal)
    );
  }

  if (retailer === "PokemonCenter") {
    const pokemonCenterConfirmationSignals = [
      "thank you for shopping at pokemoncenter.com",
      "thank you for placing an order with us",
      "order summary",
      "order details",
      "qty:",
      "price:",
      "order subtotal",
      "order total",
    ];
    return pokemonCenterConfirmationSignals.some((signal) =>
      combined.includes(signal)
    );
  }

  return false;
}

function looksCollectibleRelated(productName, bodyText) {
  const combined = `${productName || ""} ${bodyText}`;
  const hasCollectibleSignal = includesAny(combined, COLLECTIBLE_KEYWORDS);
  const hasBlockedSignal = includesAny(combined, NON_COLLECTIBLE_BLOCKLIST);
  return hasCollectibleSignal && !hasBlockedSignal;
}

async function getUserRankAndSpend(groupId, discordUserId) {
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const { data: events, error } = await supabase
    .from("checkout_events")
    .select("discord_user_id, order_total")
    .eq("group_id", groupId)
    .gte("created_at", since.toISOString());

  if (error || !events) {
    console.error("Rank calc error:", error);
    return { rank: null, spend: 0 };
  }

  const userTotals = {};

  for (const event of events) {
    const id = event.discord_user_id;
    userTotals[id] = (userTotals[id] || 0) + Number(event.order_total || 0);
  }

  const sorted = Object.entries(userTotals).sort((a, b) => b[1] - a[1]);

  let rank = null;
  let spend = 0;

  sorted.forEach(([id, total], index) => {
    if (id === discordUserId) {
      rank = index + 1;
      spend = total;
    }
  });

  return { rank, spend };
}

async function buildCheckoutEmbed(event) {
  const { rank, spend } = await getUserRankAndSpend(
    event.group_id,
    event.discord_user_id
  );

  const retailerLabel = normalizeRetailerName(event.retailer);

  const embed = {
    color: 0x57f287,
    title: `Successful Checkout | ${retailerLabel}`,
    fields: [
      {
        name: "Product",
        value: event.product_url
          ? `[${event.product_name || "Unknown Product"}](${event.product_url})`
          : `${event.product_name || "Unknown Product"}`,
        inline: false,
      },
      {
        name: "Price",
        value: formatMoney(event.order_total),
        inline: true,
      },
      {
        name: "Quantity",
        value: String(event.quantity || 1),
        inline: true,
      },
      {
        name: "Checkout Time",
        value: formatDateTime(event.created_at),
        inline: false,
      },
      {
        name: "User",
        value: `<@${event.discord_user_id}>`,
        inline: false,
      },
      {
        name: "🏆 Rank (30d)",
        value: rank ? `#${rank}` : "N/A",
        inline: true,
      },
      {
        name: "💰 Spend (30d)",
        value: formatMoney(spend || 0),
        inline: true,
      },
    ],
    footer: {
      text: `Lumen • v1.0 • ${formatDateTime(new Date())}`,
      icon_url: "https://cdn-icons-png.flaticon.com/512/4712/4712027.png",
    },
  };

  if (event.product_image) {
    embed.thumbnail = { url: event.product_image };
  }

  return embed;
}

async function sendWebhookWithRetry(url, payload, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) return true;

      console.error(
        `Webhook attempt ${i + 1} failed:`,
        res.status,
        res.statusText
      );
    } catch (err) {
      console.error(`Webhook attempt ${i + 1} error:`, err.message);
    }

    await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
  }

  return false;
}

async function sendWebhookForEvent(groupId, event) {
  const { data: group, error } = await supabase
    .from("groups")
    .select("discord_webhook_url")
    .eq("id", groupId)
    .maybeSingle();

  if (error) {
    console.error("Group webhook load error:", error.message);
    return;
  }

  if (!group?.discord_webhook_url) {
    console.error("No webhook set for group:", groupId);
    return;
  }

  const embed = await buildCheckoutEmbed(event);

  const success = await sendWebhookWithRetry(group.discord_webhook_url, {
    embeds: [embed],
  });

  if (!success) {
    console.error(
      `Webhook failed after retries for event: ${event.retailer} | ${event.product_name}`
    );
    return;
  }

  console.log(
    `Webhook sent for event: ${event.retailer} | ${event.product_name}`
  );
}

async function wasMessageProcessed(gmailConnectionId, gmailMessageId) {
  const { data, error } = await supabase
    .from("processed_gmail_messages")
    .select("id")
    .eq("gmail_connection_id", gmailConnectionId)
    .eq("gmail_message_id", gmailMessageId)
    .maybeSingle();

  if (error) {
    console.error("Processed message check error:", error.message);
    return false;
  }

  return Boolean(data);
}

async function markMessageProcessed(gmailConnectionId, gmailMessageId) {
  const { error } = await supabase
    .from("processed_gmail_messages")
    .upsert(
      {
        gmail_connection_id: gmailConnectionId,
        gmail_message_id: gmailMessageId,
      },
      {
        onConflict: "gmail_connection_id,gmail_message_id",
      }
    );

  if (error) {
    console.error("Mark processed error:", error.message);
  }
}

async function enrichProductMeta(retailer, productName, productUrl) {
  let finalName = productName || null;
  let finalUrl = productUrl || null;
  let finalImage = null;

  if (retailer === "Target") {
    finalUrl = cleanTargetUrl(finalUrl);
  }

  if (finalUrl) {
    const meta = await fetchProductMeta(finalUrl);

    if (meta.image) {
      finalImage = meta.image;
    }

    if (meta.title && (!finalName || finalName.length < 10)) {
      finalName = meta.title;
    }
  }

  return {
    product_name: finalName,
    product_url: finalUrl,
    product_image: finalImage,
  };
}

async function parseTargetEmail(bodyText, connection, internalDate, rawBody) {
  const lines = bodyText.split("\n").map(cleanCandidateLine).filter(Boolean);

  debugLog("Target parser running...");
  debugLog("Target lines preview:", lines.slice(0, 25));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^qty[: ]*\d+/i.test(line)) {
      const nearby = [lines[i - 1], lines[i - 2], lines[i - 3]]
        .map(cleanCandidateLine)
        .filter(Boolean);

      const productLine = nearby.find((candidate) => {
        if (!candidate) return false;
        if (isUrlOnlyLine(candidate)) return false;
        if (candidate.length < 8 || candidate.length > 240) return false;
        if (!includesAny(candidate, COLLECTIBLE_KEYWORDS)) return false;
        if (includesAny(candidate, NON_COLLECTIBLE_BLOCKLIST)) return false;
        return true;
      });

      if (productLine && looksCollectibleRelated(productLine, bodyText)) {
        const qtyMatch = line.match(/qty[: ]*(\d+)/i);
        const quantity = qtyMatch ? Number(qtyMatch[1]) : 1;

        let eachPrice = 0;
        for (let j = i; j < i + 5 && j < lines.length; j++) {
          const priceMatch = lines[j].match(/\$ ?(\d+(?:\.\d{2})?)\s*\/\s*ea/i);
          if (priceMatch) {
            eachPrice = Number(priceMatch[1]);
            break;
          }
        }

        if (!eachPrice) {
          const nearbyWindow = lines
            .slice(Math.max(0, i - 3), Math.min(lines.length, i + 6))
            .join(" ");
          eachPrice = extractPrice(nearbyWindow) || 0;
        }

        const bestProductLink = pickBestProductLink("Target", rawBody);
        const enriched = await enrichProductMeta(
          "Target",
          cleanProductName(productLine),
          bestProductLink
        );

        return {
          group_id: connection.group_id,
          discord_user_id: connection.discord_user_id,
          retailer: "Target",
          product_name: enriched.product_name || cleanProductName(productLine),
          product_url: enriched.product_url || bestProductLink,
          product_image: enriched.product_image || null,
          quantity,
          order_total:
            eachPrice && quantity ? eachPrice * quantity : eachPrice || 0,
          source: "gmail",
          created_at: internalDate,
        };
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const candidate = sanitizeCandidate(lines[i]);
    if (!candidate) continue;
    if (!includesAny(candidate, COLLECTIBLE_KEYWORDS)) continue;
    if (!looksCollectibleRelated(candidate, bodyText)) continue;

    const nearbyWindow = lines
      .slice(Math.max(0, i - 3), Math.min(lines.length, i + 8))
      .join(" ");
    const quantity = extractQuantity(nearbyWindow);
    const price = extractPrice(nearbyWindow) || 0;

    const bestProductLink = pickBestProductLink("Target", rawBody);
    const enriched = await enrichProductMeta(
      "Target",
      cleanProductName(candidate),
      bestProductLink
    );

    return {
      group_id: connection.group_id,
      discord_user_id: connection.discord_user_id,
      retailer: "Target",
      product_name: enriched.product_name || cleanProductName(candidate),
      product_url: enriched.product_url || bestProductLink,
      product_image: enriched.product_image || null,
      quantity,
      order_total: price,
      source: "gmail",
      created_at: internalDate,
    };
  }

  debugLog("Target parser failed.");
  return null;
}

async function parseWalmartEmail(bodyText, connection, internalDate, rawBody) {
  const lines = bodyText.split("\n").map(cleanCandidateLine).filter(Boolean);

  let productLine = null;
  let quantity = 1;
  let price = 0;

  for (let i = 0; i < lines.length; i++) {
    const safe = sanitizeCandidate(lines[i]);
    if (!safe) continue;
    if (!includesAny(safe, COLLECTIBLE_KEYWORDS)) continue;

    const nearbyWindow = lines
      .slice(i, Math.min(i + 10, lines.length))
      .join(" ");
    const nearbyQty = extractQuantity(nearbyWindow);
    const nearbyPrice = extractPrice(nearbyWindow);

    if (nearbyQty || nearbyPrice || /\bitems?\b/i.test(nearbyWindow)) {
      productLine = safe;
      quantity = nearbyQty || 1;
      price = nearbyPrice || 0;
      break;
    }
  }

  if (!productLine) return null;
  if (!looksCollectibleRelated(productLine, bodyText)) return null;

  const bestProductLink = pickBestProductLink("Walmart", rawBody);
  const enriched = await enrichProductMeta(
    "Walmart",
    cleanProductName(productLine),
    bestProductLink
  );

  return {
    group_id: connection.group_id,
    discord_user_id: connection.discord_user_id,
    retailer: "Walmart",
    product_name: enriched.product_name || cleanProductName(productLine),
    product_url: enriched.product_url || bestProductLink,
    product_image: enriched.product_image || null,
    quantity,
    order_total: price || 0,
    source: "gmail",
    created_at: internalDate,
  };
}

async function parsePokemonCenterEmail(
  bodyText,
  connection,
  internalDate,
  rawBody
) {
  const lines = bodyText.split("\n").map(cleanCandidateLine).filter(Boolean);

  debugLog("PokemonCenter parser running...");
  debugLog("PokemonCenter lines preview:", lines.slice(0, 80));

  function isBadPokemonCenterLine(line) {
    const normalized = normalizeText(line);

    if (!normalized) return true;
    if (
      normalized === "sincerely," ||
      normalized === "pokémon center" ||
      normalized === "pokemon center"
    ) {
      return true;
    }
    if (normalized.includes("billing address")) return true;
    if (normalized.includes("shipping address")) return true;
    if (normalized.includes("order details")) return true;
    if (normalized.includes("order summary")) return true;
    if (normalized.includes("order subtotal")) return true;
    if (normalized.includes("sales tax")) return true;
    if (normalized.includes("shipping")) return true;
    if (normalized.includes("order total")) return true;
    if (normalized.includes("customer support")) return true;
    if (normalized.includes("refund policy")) return true;
    if (normalized.includes("terms of use")) return true;
    if (normalized.includes("privacy notice")) return true;
    if (normalized.includes("legal info")) return true;
    if (/^sku\b/i.test(line)) return true;
    if (/^\$?\d+(\.\d{2})?$/.test(normalized)) return true;
    if (/^[a-z]+\s+[a-z]+,\s*[a-z]{2}\s*\d{5}$/i.test(line)) return true;

    return false;
  }

  function isGoodPokemonCenterProductLine(line, fullBodyText) {
    if (!line) return false;
    if (isBadPokemonCenterLine(line)) return false;
    if (!includesAny(line, COLLECTIBLE_KEYWORDS)) return false;
    if (!looksCollectibleRelated(line, fullBodyText)) return false;
    return true;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^qty[: ]*\d+/i.test(line)) {
      const nearbyCandidates = [
        lines[i - 1],
        lines[i - 2],
        lines[i - 3],
        lines[i - 4],
        lines[i - 5],
      ].filter(Boolean);

      const productLine = nearbyCandidates.find((candidate) =>
        isGoodPokemonCenterProductLine(candidate, bodyText)
      );

      if (!productLine) continue;

      const qtyMatch = line.match(/qty[: ]*(\d+)/i);
      const quantity = qtyMatch ? Number(qtyMatch[1]) : 1;

      let unitPrice = 0;
      for (let j = i; j < i + 8 && j < lines.length; j++) {
        const priceMatch = lines[j].match(/price[: ]*\$ ?(\d+(?:\.\d{2})?)/i);
        if (priceMatch) {
          unitPrice = Number(priceMatch[1]);
          break;
        }
      }

      if (!unitPrice) {
        const nearbyWindow = lines
          .slice(Math.max(0, i - 3), Math.min(lines.length, i + 10))
          .join(" ");
        unitPrice = extractPrice(nearbyWindow) || 0;
      }

      const bestProductLink = pickBestProductLink("Pokemon Center", rawBody);
      const enriched = await enrichProductMeta(
        "Pokemon Center",
        cleanProductName(productLine),
        bestProductLink
      );

      debugLog("PokemonCenter qty/price match:", productLine);

      return {
        group_id: connection.group_id,
        discord_user_id: connection.discord_user_id,
        retailer: "Pokemon Center",
        product_name: enriched.product_name || cleanProductName(productLine),
        product_url: enriched.product_url || bestProductLink,
        product_image: enriched.product_image || null,
        quantity,
        order_total:
          unitPrice && quantity ? unitPrice * quantity : unitPrice || 0,
        source: "gmail",
        created_at: internalDate,
      };
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const candidate = sanitizeCandidate(lines[i]);
    if (!candidate) continue;
    if (!isGoodPokemonCenterProductLine(candidate, bodyText)) continue;

    const nearbyWindow = lines
      .slice(Math.max(0, i - 5), Math.min(lines.length, i + 12))
      .join(" ");

    const quantity = extractQuantity(nearbyWindow) || 1;

    let price = 0;
    const explicitPriceMatch = nearbyWindow.match(
      /price[: ]*\$ ?(\d+(?:\.\d{2})?)/i
    );
    if (explicitPriceMatch) {
      price = Number(explicitPriceMatch[1]);
    } else {
      price = extractPrice(nearbyWindow) || 0;
    }

    const bestProductLink = pickBestProductLink("Pokemon Center", rawBody);
    const enriched = await enrichProductMeta(
      "Pokemon Center",
      cleanProductName(candidate),
      bestProductLink
    );

    debugLog("PokemonCenter fallback matched:", candidate);

    return {
      group_id: connection.group_id,
      discord_user_id: connection.discord_user_id,
      retailer: "Pokemon Center",
      product_name: enriched.product_name || cleanProductName(candidate),
      product_url: enriched.product_url || bestProductLink,
      product_image: enriched.product_image || null,
      quantity,
      order_total: price,
      source: "gmail",
      created_at: internalDate,
    };
  }

  debugLog("PokemonCenter parser failed.");
  return null;
}

async function parseOrderEmail(fullMessage, connection) {
  const payload = fullMessage.payload;
  const headers = payload?.headers || [];

  const subject = extractHeader(headers, "Subject");
  const from = extractHeader(headers, "From");
  const internalDate = fullMessage.internalDate
    ? new Date(Number(fullMessage.internalDate)).toISOString()
    : new Date().toISOString();

  const rawBody = extractBodyText(payload);
  const bodyText = normalizeMultilineText(stripHtmlPreserveLines(rawBody));

  const retailer = detectRetailer(from, subject, bodyText);

  debugLog("Retailer detected:", retailer);
  debugLog("From:", from);
  debugLog("Subject:", subject);

  if (!retailer) {
    debugLog("Skip reason: no retailer detected");
    return null;
  }

  const isTestSender = ENABLE_TEST_SENDERS
    ? senderMatchesRetailer("Test", from)
    : false;

  if (!isTestSender && !senderMatchesRetailer(retailer, from)) {
    debugLog("Skip reason: sender mismatch");
    return null;
  }

  const isInitialConfirmation = isInitialOrderConfirmation(
    retailer,
    subject,
    bodyText
  );
  const isShipping = isShippingOrTrackingEmail(retailer, subject, bodyText);

  debugLog("Initial confirmation result:", isInitialConfirmation);
  debugLog("Shipping filter result:", isShipping);

  if (!isInitialConfirmation) {
    debugLog("Skip reason: not initial order confirmation");
    return null;
  }

  if (retailer === "Target") {
    return parseTargetEmail(bodyText, connection, internalDate, rawBody);
  }

  if (retailer === "Walmart") {
    return parseWalmartEmail(bodyText, connection, internalDate, rawBody);
  }

  if (retailer === "PokemonCenter") {
    return parsePokemonCenterEmail(bodyText, connection, internalDate, rawBody);
  }

  return null;
}

async function refreshAccessTokenIfNeeded(connection) {
  oauth2Client.setCredentials({
    access_token: connection.access_token,
    refresh_token: connection.refresh_token,
  });

  if (!connection.refresh_token) {
    return {
      access_token: connection.access_token,
      refresh_token: connection.refresh_token,
    };
  }

  try {
    const { credentials } = await oauth2Client.refreshAccessToken();
    const newAccessToken = credentials.access_token || connection.access_token;
    const newRefreshToken =
      credentials.refresh_token || connection.refresh_token;
    const expiry = credentials.expiry_date
      ? new Date(credentials.expiry_date).toISOString()
      : connection.token_expiry;

    await supabase
      .from("gmail_connections")
      .update({
        access_token: newAccessToken,
        refresh_token: newRefreshToken,
        token_expiry: expiry,
      })
      .eq("id", connection.id);

    return {
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
    };
  } catch (err) {
    console.error("Token refresh failed:", err.message);
    return {
      access_token: connection.access_token,
      refresh_token: connection.refresh_token,
    };
  }
}

function decodeImapBuffer(value) {
  if (!value) return "";
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return String(value);
}

async function parseYahooMessage(messageData, connection) {
  const envelope = messageData.envelope || {};
  const from = (envelope.from || [])
    .map((item) => `${item.name || ""} <${item.address || ""}>`)
    .join(", ");
  const subject = envelope.subject || "";
  const internalDate = messageData.internalDate
    ? new Date(messageData.internalDate).toISOString()
    : new Date().toISOString();

  const rawSource = decodeImapBuffer(messageData.source);
  const parts = rawSource.split(/\r?\n\r?\n/);
  let mimeBody = parts.length > 1 ? parts.slice(1).join("\n\n") : rawSource;

  mimeBody = decodeQuotedPrintable(mimeBody);

  const fakeFullMessage = {
    internalDate: String(new Date(internalDate).getTime()),
    payload: {
      headers: [
        { name: "Subject", value: subject },
        { name: "From", value: from },
      ],
      body: {
        data: Buffer.from(mimeBody, "utf8")
          .toString("base64")
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/g, ""),
      },
    },
  };

  return parseOrderEmail(fakeFullMessage, connection);
}

async function checkYahooEmails(connection) {
  const client = new ImapFlow({
    host: "imap.mail.yahoo.com",
    port: 993,
    secure: true,
    auth: {
      user: connection.email,
      pass: connection.yahoo_app_password,
    },
  });

  await client.connect();

  try {
    const lock = await client.getMailboxLock("INBOX");

    try {
      const mailbox = await client.mailboxOpen("INBOX");
      const lastUid = Number(connection.yahoo_last_uid || 0);

      if (!mailbox.exists) {
        debugLog(`Yahoo inbox empty for ${connection.email}`);
        return;
      }

      const searchRange =
        lastUid > 0
          ? `${lastUid + 1}:*`
          : `${Math.max(1, mailbox.exists - 20)}:*`;

      const messages = [];

      for await (const msg of client.fetch(searchRange, {
        uid: true,
        envelope: true,
        source: true,
        internalDate: true,
      })) {
        messages.push(msg);
      }

      if (!messages.length) {
        debugLog(`No new Yahoo messages for ${connection.email}`);
        return;
      }

      console.log(`Yahoo new messages for ${connection.email}:`, messages.length);

      let highestUidSeen = lastUid;

      for (const msg of messages) {
        highestUidSeen = Math.max(highestUidSeen, Number(msg.uid || 0));

        const yahooMessageId = `yahoo-${msg.uid}`;
        const alreadyProcessed = await wasMessageProcessed(
          connection.id,
          yahooMessageId
        );

        if (alreadyProcessed) {
          continue;
        }

        const parsedEvent = await parseYahooMessage(msg, connection);

        if (!parsedEvent) {
          await markMessageProcessed(connection.id, yahooMessageId);
          continue;
        }

        const { data: insertedEvent, error: insertError } = await supabase
          .from("checkout_events")
          .insert(parsedEvent)
          .select()
          .single();

        if (insertError) {
          console.error("Yahoo event insert error:", insertError.message);
          continue;
        }

        console.log(
          `Yahoo collectible checkout detected: ${insertedEvent.retailer} | ${insertedEvent.product_name}`
        );

        await sendWebhookForEvent(insertedEvent.group_id, insertedEvent);
        await markMessageProcessed(connection.id, yahooMessageId);
      }

      if (highestUidSeen > lastUid) {
        const { error: uidUpdateError } = await supabase
          .from("gmail_connections")
          .update({ yahoo_last_uid: highestUidSeen })
          .eq("id", connection.id);

        if (uidUpdateError) {
          console.error(
            "Yahoo last UID update error:",
            uidUpdateError.message
          );
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

async function checkEmails() {
  const { data: connections, error: connectionError } = await supabase
    .from("gmail_connections")
    .select("*")
    .eq("status", "connected");

  if (connectionError) {
    console.error("Connection load error:", connectionError.message);
    return;
  }

  console.log(
    `Checking emails for ${connections?.length || 0} connected inbox(es)...`
  );

  for (const connection of connections || []) {
    try {
      if (connection.provider === "yahoo") {
        if (!connection.email || !connection.yahoo_app_password) {
          console.error(
            "Skipping Yahoo connection with missing credentials:",
            connection.id
          );
          continue;
        }

        await checkYahooEmails(connection);
        continue;
      }

      const tokens = await refreshAccessTokenIfNeeded(connection);

      oauth2Client.setCredentials({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
      });

      const gmail = google.gmail({ version: "v1", auth: oauth2Client });

      const gmailQuery =
        '-in:sent newer_than:14d ("order" OR "thank you" OR "order summary" OR "pokemoncenter.com")';

      const res = await gmail.users.messages.list({
        userId: "me",
        labelIds: ["INBOX"],
        q: gmailQuery,
        maxResults: 20,
      });

      const messages = res.data.messages || [];
      debugLog("Gmail messages found:", messages.length);

      for (const msg of messages) {
        const alreadyProcessed = await wasMessageProcessed(connection.id, msg.id);

        if (alreadyProcessed) {
          continue;
        }

        const full = await gmail.users.messages.get({
          userId: "me",
          id: msg.id,
        });

        const labels = full.data.labelIds || [];
        if (labels.includes("SENT")) {
          continue;
        }

        const parsedEvent = await parseOrderEmail(full.data, connection);

        if (!parsedEvent) {
          continue;
        }

        const { data: insertedEvent, error: insertError } = await supabase
          .from("checkout_events")
          .insert(parsedEvent)
          .select()
          .single();

        if (insertError) {
          console.error("Event insert error:", insertError.message);
          continue;
        }

        console.log(
          `Gmail collectible checkout detected: ${insertedEvent.retailer} | ${insertedEvent.product_name}`
        );

        await sendWebhookForEvent(insertedEvent.group_id, insertedEvent);
        await markMessageProcessed(connection.id, msg.id);
      }
    } catch (err) {
      console.error("Email read error:", err.message);
    }
  }
}

module.exports = { checkEmails };