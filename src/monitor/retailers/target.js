"use strict";

/**
 * src/monitor/retailers/target.js
 * Monitors Target using their guest API endpoints.
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

async function fetchWithFallback(url, headers, timeout = 12000) {
  // Try with proxy first
  let result = await proxyFetch(url, { headers, timeout }, getProxy());
  if (result && result.status === 200) return result;

  // Fallback to direct
  result = await proxyFetch(url, { headers, timeout }, null);
  return result;
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
  // Target's guest API — returns full product data including availability
  const url = `https://api.target.com/products/v3/${tcin}?fields=available_to_promise_network,item,price,promotion,available_to_promise_stores,inventory&key=ff457966e64d5e877fdbad070f276d18ecec4a01`;

  const headers = {
    "User-Agent": ua(),
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.target.com/",
    "Host": "api.target.com",
    "Origin": "https://www.target.com",
  };

  const result = await fetchWithFallback(url, headers);

  if (!result || result.status !== 200) {
    // Try alternate endpoint
    return await checkByTcinV2(tcin);
  }

  try {
    const data = JSON.parse(result.body);
    const product = data?.data?.product || data?.product;
    if (!product) return await checkByTcinV2(tcin);

    const avail = product?.available_to_promise_network?.availability ||
      product?.availability_status || "OUT_OF_STOCK";

    const inStock = avail === "IN_STOCK" || avail === "AVAILABLE";
    const isLaunch = avail === "READY_FOR_LAUNCH";

    const price = product?.price?.current_retail || null;
    const productName = product?.item?.product_description?.title || null;
    const productUrl = `https://www.target.com/p/A-${tcin}`;

    log.info("Target product checked", { tcin, status: inStock ? "IN_STOCK" : isLaunch ? "READY_FOR_LAUNCH" : "OUT_OF_STOCK", productName: productName?.slice(0, 50) });

    return {
      status: inStock ? "IN_STOCK" : isLaunch ? "READY_FOR_LAUNCH" : "OUT_OF_STOCK",
      price,
      productName,
      productUrl,
    };
  } catch (err) {
    return await checkByTcinV2(tcin);
  }
}

async function checkByTcinV2(tcin) {
  // Alternate: Target's fulfillment API
  const url = `https://redsky.target.com/v3/pdp/tcin/${tcin}?excludes=taxonomy,promotion,bulk_ship,rating_and_review_reviews,rating_and_review_statistics,question_answer_statistics&key=ff457966e64d5e877fdbad070f276d18ecec4a01`;

  const headers = {
    "User-Agent": ua(),
    "Accept": "application/json",
    "Referer": "https://www.target.com/",
    "Host": "redsky.target.com",
  };

  const result = await fetchWithFallback(url, headers);
  if (!result || result.status !== 200) {
    log.warn("Target v2 API non-OK", { status: result?.status, tcin });
    return { status: "UNKNOWN" };
  }

  try {
    const data = JSON.parse(result.body);
    const product = data?.data?.product;
    if (!product) return { status: "UNKNOWN" };

    const avail = product?.availability?.availability_status || "OUT_OF_STOCK";
    const inStock = avail === "IN_STOCK";
    const isLaunch = avail === "READY_FOR_LAUNCH";

    const price = product?.price?.current_retail || null;
    const productName = product?.item?.product_description?.title || null;
    const productUrl = `https://www.target.com/p/A-${tcin}`;

    // Filter 3rd party
    const sellerName = product?.item?.seller?.display_name || "";
    if (sellerName && sellerName.toLowerCase() !== "target") {
      log.info("Skipping 3rd party", { tcin, seller: sellerName });
      return { status: "UNKNOWN" };
    }

    log.info("Target product checked (v2)", { tcin, status: inStock ? "IN_STOCK" : isLaunch ? "READY_FOR_LAUNCH" : "OUT_OF_STOCK" });

    return {
      status: inStock ? "IN_STOCK" : isLaunch ? "READY_FOR_LAUNCH" : "OUT_OF_STOCK",
      price,
      productName,
      productUrl,
    };
  } catch (err) {
    log.error("Target v2 parse failed", { tcin, error: err.message });
    return { status: "UNKNOWN" };
  }
}

async function searchByKeyword(keyword) {
  try {
    const params = new URLSearchParams({
      key: "ff457966e64d5e877fdbad070f276d18ecec4a01",
      keyword,
      channel: "WEB",
      count: "24",
      default_purchasability_filter: "false",
      offset: "0",
      visitor_id: "01800CC62F6C0201AF2C0E6116E9A0EF",
      zip: "55413",
      store_id: "911",
    });

    const url = `https://redsky.target.com/redsky_aggregations/v1/web/plp_search_v2?${params}`;
    const headers = {
      "User-Agent": ua(),
      "Accept": "application/json",
      "Referer": "https://www.target.com/",
      "Host": "redsky.target.com",
    };

    const result = await fetchWithFallback(url, headers);
    if (!result || result.status !== 200) return { status: "UNKNOWN" };

    const data = JSON.parse(result.body);
    const items = data?.data?.search?.products || [];
    if (!items.length) return { status: "UNKNOWN" };

    const first = items[0];
    const tcin = first?.tcin;
    if (!tcin) return { status: "UNKNOWN" };

    return await checkByTcin(tcin);
  } catch (err) {
    log.error("Target search failed", { keyword, error: err.message });
    return { status: "UNKNOWN" };
  }
}

module.exports = { checkProduct };
