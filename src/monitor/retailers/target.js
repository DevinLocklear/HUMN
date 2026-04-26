"use strict";

/**
 * src/monitor/retailers/target.js
 * Monitors Target using their storefront API — no API key needed.
 */

const { createLogger } = require("../../logger");
const { proxyFetch } = require("../fetch");

const log = createLogger("monitor:target");

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

async function checkProduct(product) {
  try {
    if (product.identifier_type === "keyword") {
      return await searchByKeyword(product.identifier);
    }
    return await checkByTcin(product.identifier);
  } catch (err) {
    log.error("Target check failed", { product: product.identifier, error: err.message });
    return { status: "UNKNOWN" };
  }
}

async function checkByTcin(tcin) {
  // Use Target's guest API — most reliable, no key needed
  const url = `https://api.target.com/fulfillment/v2/fixtured/fulfillment_slot_configuration?key=9f36aeafbe60771e321a7cc95a78140772ab3e96&tcin=${tcin}`;

  // Actually use the product page directly and parse JSON-LD
  return await checkByPage(tcin);
}

async function checkByPage(tcin) {
  const url = `https://www.target.com/p/-/A-${tcin}`;

  const headers = {
    "User-Agent": ua(),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer": "https://www.target.com/",
    "Host": "www.target.com",
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
  };

  // Try with proxy first
  let result = await proxyFetch(url, { headers, timeout: 12000 }, getProxy());

  // Fallback to direct if proxy fails
  if (!result || result.status === 0 || result.status >= 500) {
    result = await proxyFetch(url, { headers, timeout: 12000 }, null);
  }

  if (!result || result.status === 404) return { status: "UNKNOWN" };
  if (result.status !== 200) {
    log.warn("Target page non-OK", { status: result.status, tcin });
    return { status: "UNKNOWN" };
  }

  const html = result.body;

  // Extract product data from page
  const productName = extractProductName(html);
  const productUrl = `https://www.target.com/p/A-${tcin}`;

  // Check availability signals in page
  if (html.includes('"availability_status":"IN_STOCK"') ||
      html.includes('"availabilityStatus":"IN_STOCK"') ||
      html.includes('"inStockNearby":true')) {
    const price = extractPrice(html);
    log.info("Target product checked", { tcin, status: "IN_STOCK", productName: productName?.slice(0, 50) });
    return { status: "IN_STOCK", price, productName, productUrl };
  }

  if (html.includes('"availability_status":"READY_FOR_LAUNCH"') ||
      html.includes('"availabilityStatus":"READY_FOR_LAUNCH"')) {
    log.info("Target product checked", { tcin, status: "READY_FOR_LAUNCH", productName: productName?.slice(0, 50) });
    return { status: "READY_FOR_LAUNCH", productName, productUrl };
  }

  if (html.includes('"availability_status":"OUT_OF_STOCK"') ||
      html.includes('"availabilityStatus":"OUT_OF_STOCK"') ||
      html.includes('"availabilityStatus":"UNAVAILABLE"')) {
    log.info("Target product checked", { tcin, status: "OUT_OF_STOCK", productName: productName?.slice(0, 50) });
    return { status: "OUT_OF_STOCK", productName, productUrl };
  }

  // Check for add to cart button as fallback
  if (html.includes('"add to cart"') || html.includes('"Add to cart"') || html.includes('addToCartButton')) {
    return { status: "IN_STOCK", productName, productUrl };
  }

  log.info("Target product checked", { tcin, status: "UNKNOWN" });
  return { status: "UNKNOWN", productName, productUrl };
}

function extractProductName(html) {
  try {
    const match = html.match(/"name":"([^"]{5,200})"/);
    return match ? match[1].replace(/\\u[\dA-F]{4}/gi, c =>
      String.fromCharCode(parseInt(c.replace(/\\u/i, ""), 16))) : null;
  } catch { return null; }
}

function extractPrice(html) {
  try {
    const match = html.match(/"current_retail":([\d.]+)/);
    return match ? parseFloat(match[1]) : null;
  } catch { return null; }
}

async function searchByKeyword(keyword) {
  try {
    const url = `https://www.target.com/s?searchTerm=${encodeURIComponent(keyword)}`;
    const headers = {
      "User-Agent": ua(),
      "Accept": "text/html,application/xhtml+xml",
      "Host": "www.target.com",
      "Referer": "https://www.target.com/",
    };

    const result = await proxyFetch(url, { headers, timeout: 12000 }, getProxy());
    if (!result || result.status !== 200) return { status: "UNKNOWN" };

    const tcinMatch = result.body.match(/"tcin":"(\d+)"/);
    if (!tcinMatch) return { status: "UNKNOWN" };

    return await checkByPage(tcinMatch[1]);
  } catch (err) {
    log.error("Target search failed", { keyword, error: err.message });
    return { status: "UNKNOWN" };
  }
}

module.exports = { checkProduct };
