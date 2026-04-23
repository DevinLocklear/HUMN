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

const RETAILER_ICONS = {
  target: "<:target:1> 🎯",
  walmart: "🛒",
  pokemoncenter: "⚡",
  gamestop: "🎮",
  amazon: "📦",
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
  if (key === "walmart") return `https://www.walmart.com/cart/add?itemId=${identifier}&quantity=2`;
  if (key === "pokemoncenter") return productUrl || "https://www.pokemoncenter.com";
  return productUrl || "#";
}

function getOpenInAppUrl(retailer, identifier) {
  const key = getRetailerKey(retailer);
  if (key === "target") return `https://www.target.com/p/A-${identifier}`;
  if (key === "walmart") return `https://www.walmart.com/ip/${identifier}`;
  return null;
}

async function sendRestockAlert({ webhookUrl, product, status, previousStatus, price, stockCount, cartLimit }) {
  const retailerKey = getRetailerKey(product.retailer);
  const color = RETAILER_COLORS[retailerKey] || 0xc45aff;

  const isRestock = previousStatus === "OUT_OF_STOCK" && status === "IN_STOCK";
  const isNewLaunch = (previousStatus === null || previousStatus === "UNKNOWN") && status === "IN_STOCK";
  const isEarlyAlert = status === "READY_FOR_LAUNCH";

  let type = "Restock";
  if (isNewLaunch) type = "New Product";
  if (isEarlyAlert) type = "Coming Soon";

  const productName = product.product_name || "Unknown Product";
  const identifier = product.identifier;
  const productUrl = product.product_url || "";

  const cartUrl = getCartUrl(product.retailer, productUrl, identifier);
  const appUrl = getOpenInAppUrl(product.retailer, identifier);
  const ebayUrl = getEbaySearchUrl(productName);
  const ebaySalesUrl = getEbaySalesUrl(productName);
  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

  // Build links line
  const links = [];
  if (cartUrl) links.push(`[Cart](${cartUrl})`);
  if (appUrl) links.push(`[Open in App](${appUrl})`);
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
      name: "TCIN / SKU",
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
      name: "Open In App",
      value: `[Click Me](${appUrl})`,
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

  fields.push({
    name: "Links",
    value: links.join(" | "),
    inline: false,
  });

  fields.push({
    name: "\u200b",
    value: "[𝕏 @UseHUMN](https://x.com/UseHUMN) • [🌐 humnbot.com](https://www.humnbot.com)",
    inline: false,
  });

  const embed = {
    title: productName,
    url: productUrl || undefined,
    color,
    fields,
    thumbnail: { url: HUMN_ICON },
    footer: {
      text: `HUMN Monitor v1.0 | [${timeStr}]`,
      icon_url: HUMN_ICON,
    },
    timestamp: now.toISOString(),
  };

  // Add retailer name as author
  const retailerLabel = {
    target: "Target Restocks",
    walmart: "Walmart Restocks",
    pokemoncenter: "Pokémon Center Restocks",
    gamestop: "GameStop Restocks",
    amazon: "Amazon Restocks",
  }[retailerKey] || `${product.retailer} Restocks`;

  const payload = {
    username: retailerLabel,
    avatar_url: HUMN_ICON,
    embeds: [embed],
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      log.error("Webhook failed", { status: res.status, product: productName });
    } else {
      log.info("Monitor alert sent", { product: productName, status, retailer: product.retailer });
    }
  } catch (err) {
    log.error("Webhook error", err);
  }
}

module.exports = { sendRestockAlert };
