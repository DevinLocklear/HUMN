"use strict";

/**
 * src/monitor/retailers/walmart.js
 * Monitors Walmart for restocks and queue drops.
 */

const { createLogger } = require("../../logger");
const { proxyFetch } = require("../fetch");

const log = createLogger("monitor:walmart");

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
];

function getProxy() {
  return {
    host: process.env.PROXY_HOST || "p.webshare.io",
    port: parseInt(process.env.PROXY_PORT || "80"),
    user: process.env.PROXY_USER || "xnqyxvyg-GB-1",
    pass: process.env.PROXY_PASS || "j2prfly8xpvf",
  };
}

function ua() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function fetchWithFallback(url, headers, timeout = 12000) {
  let result = await proxyFetch(url, { headers, timeout }, getProxy());
  if (result && result.status === 200) return result;
  result = await proxyFetch(url, { headers, timeout }, null);
  return result;
}

async function checkProduct(product) {
  try {
    if (product.identifier_type === "keyword") {
      return await searchByKeyword(product.identifier);
    }
    return await checkByItemId(product.identifier);
  } catch (err) {
    log.error("Walmart check failed", { product: product.identifier, error: err.message });
    return { status: "UNKNOWN" };
  }
}

async function checkByItemId(itemId) {
  // Walmart's product API
  const url = `https://www.walmart.com/ip/${itemId}`;

  const headers = {
    "User-Agent": ua(),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.walmart.com/",
    "Host": "www.walmart.com",
  };

  const result = await fetchWithFallback(url, headers);

  if (!result || result.status !== 200) {
    log.warn("Walmart page non-OK", { status: result?.status, itemId });
    return { status: "UNKNOWN" };
  }

  try {
    const html = result.body;

    // Extract __NEXT_DATA__ from page
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!nextDataMatch) {
      log.warn("Walmart __NEXT_DATA__ not found", { itemId });
      return { status: "UNKNOWN" };
    }

    const nextData = JSON.parse(nextDataMatch[1]);
    const product = nextData?.props?.pageProps?.initialData?.data?.product;

    if (!product) {
      log.warn("Walmart product data not found", { itemId });
      return { status: "UNKNOWN" };
    }

    const availabilityStatus = product?.availabilityStatus || "";
    const offerInfo = product?.offers?.[0];
    const price = offerInfo?.priceInfo?.currentPrice?.price || product?.priceInfo?.currentPrice?.price || null;
    const productName = product?.name || null;
    const productUrl = `https://www.walmart.com/ip/${itemId}`;
    const imageUrl = product?.imageInfo?.thumbnailUrl || product?.images?.[0]?.url || null;
    const offerId = offerInfo?.offerId || null;
    const seller = offerInfo?.sellerInfo?.sellerDisplayName || "Walmart.com";

    // Skip 3rd party sellers — only Walmart.com
    const sellerLower = seller.toLowerCase();
    if (sellerLower !== "walmart.com" && sellerLower !== "walmart") {
      log.info("Skipping 3rd party seller", { itemId, seller });
      return { status: "UNKNOWN" };
    }
    const stockCount = offerInfo?.fulfillment?.availableQuantity || null;
    const cartLimit = offerInfo?.fulfillment?.maxItemsPerOrder || null;

    // Check for queue status
    const isQueue = availabilityStatus === "IN_QUEUE" ||
      html.includes('"IN_QUEUE"') ||
      html.includes('"queueEnabled":true') ||
      html.includes('"isQueue":true');

    const inStock = availabilityStatus === "IN_STOCK" ||
      availabilityStatus === "AVAILABLE" ||
      offerInfo?.availabilityStatus === "IN_STOCK";

    let status = "OUT_OF_STOCK";
    if (isQueue) status = "QUEUE";
    else if (inStock) status = "IN_STOCK";

    log.info("Walmart product checked", { itemId, status, price, productName: productName?.slice(0, 50) });

    return { status, price, productName, productUrl, imageUrl, offerId, seller, stockCount, cartLimit };
  } catch (err) {
    log.error("Walmart parse failed", { itemId, error: err.message });
    return { status: "UNKNOWN" };
  }
}

async function searchByKeyword(keyword) {
  try {
    const url = `https://www.walmart.com/search?q=${encodeURIComponent(keyword)}&cat_id=4096`;

    const headers = {
      "User-Agent": ua(),
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://www.walmart.com/",
      "Host": "www.walmart.com",
    };

    const result = await fetchWithFallback(url, headers);
    if (!result || result.status !== 200) return { status: "UNKNOWN" };

    const nextDataMatch = result.body.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!nextDataMatch) return { status: "UNKNOWN" };

    const nextData = JSON.parse(nextDataMatch[1]);
    const items = nextData?.props?.pageProps?.initialData?.searchResult?.itemStacks?.[0]?.items || [];
    if (!items.length) return { status: "UNKNOWN" };

    const first = items[0];
    const itemId = first?.usItemId || first?.itemId;
    if (!itemId) return { status: "UNKNOWN" };

    return await checkByItemId(itemId);
  } catch (err) {
    log.error("Walmart search failed", { keyword, error: err.message });
    return { status: "UNKNOWN" };
  }
}

module.exports = { checkProduct };
