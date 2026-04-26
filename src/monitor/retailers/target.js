"use strict";

/**
 * src/monitor/retailers/target.js
 * Monitors Target for restocks. Uses inventory API (confirmed working).
 */

const { createLogger } = require("../../logger");
const { proxyFetch } = require("../fetch");

// Webshare rotating residential proxy — port 80, works on Railway
function getWebshareProxy() {
  return {
    host: process.env.PROXY_HOST || "p.webshare.io",
    port: parseInt(process.env.PROXY_PORT || "80"),
    user: process.env.PROXY_USER || "xnqyxvyg-GB-1",
    pass: process.env.PROXY_PASS || "j2prfly8xpvf",
  };
}

const log = createLogger("monitor:target");

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
];

function getHeaders() {
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  return {
    "User-Agent": ua,
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer": "https://www.target.com/",
    "Host": "redsky.target.com",
    "Origin": "https://www.target.com",
    "sec-ch-ua": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site",
  };
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
  const url = `https://redsky.target.com/redsky_aggregations/v1/web/product_summary_with_fulfillment_v1?key=9f36aeafbe60771e321a7cc95a78140772ab3e96&tcins=${tcin}&store_id=911&zip=55413&state=MN&latitude=44.9934&longitude=-93.2774&visitor_id=01800CC62F6C0201AF2C0E6116E9A0EF&channel=WEB`;

  const result = await proxyFetch(url, { headers: getHeaders(), timeout: 20000 }, getWebshareProxy());

  if (result.status !== 200) {
    log.warn("Target inventory API non-OK", { status: result.status, tcin });
    return { status: "UNKNOWN" };
  }

  const data = JSON.parse(result.body);
  const pd = data?.data?.product_summaries?.[0];
  if (!pd) return { status: "UNKNOWN" };

  // Parse fulfillment/availability
  const shipping = pd?.fulfillment?.shipping_options;
  const pickup = pd?.fulfillment?.store_options?.[0];
  const availability = pd?.availability;

  const shipStatus = shipping?.availability_status;
  const pickupStatus = pickup?.availability_status;
  const availState = availability?.availability_status || availability?.state;

  let status = "OUT_OF_STOCK";

  if (
    shipStatus === "IN_STOCK" ||
    pickupStatus === "IN_STOCK" ||
    availState === "IN_STOCK"
  ) {
    status = "IN_STOCK";
  } else if (
    shipStatus === "READY_FOR_LAUNCH" ||
    availState === "READY_FOR_LAUNCH"
  ) {
    status = "READY_FOR_LAUNCH";
  }

  const price = pd?.price?.current_retail || shipping?.regular_price || null;
  const productName = pd?.item?.product_description?.title || null;
  const productUrl = `https://www.target.com/p/A-${tcin}`;
  const stockCount = shipping?.available_to_promise_quantity || null;
  const cartLimit = shipping?.purchase_limit || null;

  // Extract product image
  const images = pd?.item?.enrichment?.images || pd?.item?.product_description?.images;
  const imageUrl = images?.primary_image_url
    || images?.[0]?.base_url + images?.[0]?.primary + ".jpg"
    || null;

  log.info("Target product checked", { tcin, status, price, productName: productName?.slice(0, 50) });

  return { status, price, stockCount, cartLimit, productName, productUrl, imageUrl };
}

async function searchByKeyword(keyword) {
  try {
    const params = new URLSearchParams({
      key: "9f36aeafbe60771e321a7cc95a78140772ab3e96",
      keyword,
      channel: "WEB",
      count: "5",
      default_purchasability_filter: "false",
      offset: "0",
      visitor_id: "01800CC62F6C0201AF2C0E6116E9A0EF",
      zip: "55413",
      store_id: "911",
    });

    const url = `https://redsky.target.com/redsky_aggregations/v1/web/plp_search_v2?${params}`;

    const result = await proxyFetch(url, {
      headers: { ...HEADERS },
      timeout: 20000,
    }, getWebshareProxy());

    if (result.status !== 200) return { status: "UNKNOWN" };

    const data = JSON.parse(result.body);
    const items = data?.data?.search?.products || [];
    if (!items.length) return { status: "UNKNOWN" };

    const first = items[0];
    const tcin = first?.tcin;
    if (!tcin) return { status: "UNKNOWN" };

    // Now check that TCIN properly
    return await checkByTcin(tcin);
  } catch (err) {
    log.error("Target search failed", { keyword, error: err.message });
    return { status: "UNKNOWN" };
  }
}

module.exports = { checkProduct };
