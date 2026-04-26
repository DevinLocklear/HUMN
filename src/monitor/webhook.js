"use strict";

/**
 * src/monitor/webhook.js
 * Sends Discord webhook embeds for monitor alerts.
 */

const { createLogger } = require("../logger");
const log = createLogger("monitor:webhook");

const HUMN_ICON = "https://i.imgur.com/ywgtHOK.png";

const RETAILER_COLORS = {
  target: 0xcc0000,
  walmart: 0x0071ce,
  pokemoncenter: 0xffcc00,
  gamestop: 0xff6600,
  amazon: 0xff9900,
};

function getRetailerKey(retailer) {
  return (retailer || "").toLowerCase().replace(/\s/g, "");
}

function getEbaySearchUrl(productName) {
  if (!productName) return "https://www.ebay.com";
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(productName)}`;
}

function getEbaySalesUrl(productName) {
  if (!productName) return "https://www.ebay.com";
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(productName)}&LH_Sold=1&LH_Complete=1`;
}

function getCartUrl(retailer, productUrl, identifier) {
  const key = getRetailerKey(retailer);
  if (key === "target") return `https://www.target.com/cart?item=${identifier}&quantity=2`;
  if (key === "walmart") return `https://www.walmart.com/cart/add?itemId=${identifier}&qty=2`;
  if (key === "pokemoncenter") return `https://www.pokemoncenter.com/en-us/cart?add=${identifier}&qty=1`;
  if (key === "gamestop") return `https://www.gamestop.com/cart?add=${identifier}&quantity=1`;
  if (key === "amazon") return `https://www.amazon.com/gp/aws/cart/add.html?ASIN.1=${identifier}&Quantity.1=1`;
  return productUrl || "#";
}

function getLoginUrl(retailer) {
  const key = getRetailerKey(retailer);
  if (key === "target") return "https://www.target.com/account";
  if (key === "walmart") return "https://www.walmart.com/account/login";
  if (key === "pokemoncenter") return "https://www.pokemoncenter.com/en-us/login";
  if (key === "gamestop") return "https://www.gamestop.com/login";
  if (key === "amazon") return "https://www.amazon.com/ap/signin";
  return "#";
}

function getAppUrl(retailer, identifier, productUrl) {
  const key = getRetailerKey(retailer);
  if (key === "target") return `https://www.target.com/p/A-${identifier}`;
  if (key === "walmart") return `https://www.walmart.com/ip/${identifier}`;
  return productUrl || null;
}

async function sendRestockAlert({ webhookUrl, product, status, previousStatus, price, stockCount, cartLimit, imageUrl, offerId, seller }) {
  const retailerKey = getRetailerKey(product.retailer);
  const color = RETAILER_COLORS[retailerKey] || 0xc45aff;

  const isRestock = previousStatus === "OUT_OF_STOCK" && status === "IN_STOCK";
  const isNewLaunch = (previousStatus === null || previousStatus === "UNKNOWN") && status === "IN_STOCK";
  const isEarlyAlert = status === "READY_FOR_LAUNCH";

  const isQueue = status === "QUEUE";
  let type = "Restock";
  if (isNewLaunch) type = "New Product";
  if (isEarlyAlert) type = "Coming Soon";
  if (isQueue) type = "Queue Drop";

  const isQueueDrop = status === "QUEUE";
  const productName = (isQueueDrop ? "[Queue Up] " : "") + (product.product_name || "Unknown Product");
  const identifier = product.identifier;
  const productUrl = product.product_url || "";

  const cartUrl = getCartUrl(product.retailer, productUrl, identifier);
  const loginUrl = getLoginUrl(product.retailer);
  const appUrl = getAppUrl(product.retailer, identifier, productUrl);
  const ebayUrl = getEbaySearchUrl(productName);
  const ebaySalesUrl = getEbaySalesUrl(productName);

  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

  // Build links
  const links = [];
  if (cartUrl) links.push(`[Cart](${cartUrl})`);
  if (retailerKey === "walmart") links.push(`[Checkout](https://www.walmart.com/account/checkout)`);
  if (appUrl) links.push(`[Open in App](${appUrl})`);
  if (loginUrl) links.push(`[Login](${loginUrl})`);
  links.push(`[eBay](${ebayUrl})`);
  links.push(`[eBay Sales](${ebaySalesUrl})`);

  const fields = [
    {
      name: "Price",
      value: price ? `$${Number(price).toFixed(2)}` : "N/A",
      inline: true,
    },
    {
      name: "Type",
      value: type,
      inline: true,
    },
    {
      name: "TCIN / PID",
      value: `\`${identifier}\``,
      inline: true,
    },
  ];

  if (stockCount) {
    fields.push({
      name: "Total Stock",
      value: `${stockCount}`,
      inline: true,
    });
  }

  if (appUrl) {
    fields.push({
      name: "Open in App",
      value: `[Click Here](${appUrl})`,
      inline: true,
    });
  }

  if (cartLimit) {
    fields.push({
      name: "Cart Limit",
      value: `${cartLimit}`,
      inline: true,
    });
  }

  if (offerId) {
    fields.push({
      name: "Offer Id",
      value: `\`${offerId}\``,
      inline: true,
    });
  }

  if (seller) {
    fields.push({
      name: "Seller",
      value: seller,
      inline: true,
    });
  }

  fields.push({
    name: "Links",
    value: links.join(" | "),
    inline: false,
  });

  // Social links at very bottom
  fields.push({
    name: "\u200b",
    value: "[x.com/UseHUMN](https://x.com/UseHUMN) • [humnbot.com](https://www.humnbot.com)",
    inline: false,
  });

  const embed = {
    title: productName,
    url: productUrl || undefined,
    color,
    fields,
    thumbnail: { url: imageUrl || HUMN_ICON },
    footer: {
      text: `HUMN Monitor v1.0 | [${timeStr}]`,
      icon_url: HUMN_ICON,
    },
    timestamp: now.toISOString(),
  };

  const retailerLabel = {
    target: "Target Restocks",
    walmart: "Walmart Restocks",
    pokemoncenter: "Pokemon Center Restocks",
    gamestop: "GameStop Restocks",
    amazon: "Amazon Restocks",
  }[retailerKey] || `${product.retailer} Restocks`;

  const payload = {
    username: retailerLabel,
    avatar_url: HUMN_ICON,
    embeds: [embed],
  };

  try {
    log.info("Firing webhook", { webhookUrl: webhookUrl.slice(0, 60), product: productName });
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    const body = await res.text();
    if (!res.ok) {
      log.error("Webhook failed", { status: res.status, body, product: productName });
    } else {
      log.info("Monitor alert sent", { product: productName, status, retailer: product.retailer });
    }
  } catch (err) {
    log.error("Webhook error", { error: err.message, product: productName });
  }
}

module.exports = { sendRestockAlert };
