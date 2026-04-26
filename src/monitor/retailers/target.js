"use strict";

/**
 * src/monitor/retailers/target.js
 * Monitors Target using the inventory API (confirmed working).
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
  // Use proxy first — Railway IP is rate limited by Target
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
  // Inventory endpoint — confirmed working
  const url = `https://redsky.target.com/redsky_aggregations/v1/web/product_summary_with_fulfillment_v1?key=ff457966e64d5e877fdbad070f276d18ecec4a01&tcins=${tcin}&store_id=911&zip=55413&state=MN&latitude=44.9934&longitude=-93.2774&visitor_id=01800CC62F6C0201AF2C0E6116E9A0EF&channel=WEB`;

  const headers = {
    "User-Agent": ua(),
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.target.com/",
    "Host": "redsky.target.com",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
  };

  const result = await fetchWithFallback(url, headers);

  if (result?.status === 410) {
    log.info("Target product temporarily unavailable (410)", { tcin });
    return { status: "OUT_OF_STOCK" };
  }

  if (!result || result.status !== 200) {
    log.warn("Target inventory API non-OK", { status: result?.status, tcin });
    return { status: "UNKNOWN" };
  }

  try {
    const data = JSON.parse(result.body);
    const pd = data?.data?.product_summaries?.[0];
    if (!pd) return { status: "UNKNOWN" };

    const shipping = pd?.fulfillment?.shipping_options;
    const availability = pd?.availability;
    const shipStatus = shipping?.availability_status;
    const availState = availability?.availability_status || availability?.state;

    let status = "OUT_OF_STOCK";
    if (shipStatus === "IN_STOCK" || availState === "IN_STOCK") status = "IN_STOCK";
    else if (shipStatus === "READY_FOR_LAUNCH" || availState === "READY_FOR_LAUNCH") status = "READY_FOR_LAUNCH";

    const price = pd?.price?.current_retail || null;
    const productName = pd?.item?.product_description?.title || null;
    const productUrl = `https://www.target.com/p/A-${tcin}`;
    const stockCount = shipping?.available_to_promise_quantity || null;
    const cartLimit = shipping?.purchase_limit || null;
    const images = pd?.item?.enrichment?.images;
    const imageUrl = images?.primary_image_url || null;

    log.info("Target product checked", { tcin, status, productName: productName?.slice(0, 50) });

    return { status, price, stockCount, cartLimit, productName, productUrl, imageUrl };
  } catch (err) {
    log.error("Target parse failed", { tcin, error: err.message });
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
