"use strict";

/**
 * src/monitor/retailers/target.js
 * Monitors Target for restocks and early (pre-launch) products.
 */

const { createLogger } = require("../../logger");
const { getProxy } = require("../proxy");
const { proxyFetch } = require("../fetch");

const log = createLogger("monitor:target");

const VISITOR_ID = "0GbNtQj7gW3p3dHMAAAADQ";

function getHeaders(hostname) {
  return {
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.target.com/",
    "Origin": "https://www.target.com",
    "Host": hostname,
  };
}

async function checkProduct(product) {
  try {
    if (product.identifier_type === "keyword") {
      return await searchByKeyword(product.identifier);
    }

    const tcin = product.identifier;
    const params = new URLSearchParams({
      key: "9f36aeafbe60771e321a7cc95a78140772ab3e96",
      tcins: tcin,
      store_id: "3991",
      zip: "90210",
      state: "CA",
      latitude: "34.0901",
      longitude: "-118.4065",
      visitor_id: VISITOR_ID,
      channel: "WEB",
      page: `/p/A-${tcin}`,
    });

    const url = `https://redsky.target.com/redsky_aggregations/v1/web/product_summary_with_fulfillment_v1?${params}`;
    const proxy = null; // Proxy disabled — Railway blocks port 3128

    const result = await proxyFetch(url, {
      headers: getHeaders("redsky.target.com"),
      timeout: 20000,
    }, proxy);

    if (result.status !== 200) {
      log.warn("Target API non-OK", { status: result.status, tcin });
      return { status: "UNKNOWN" };
    }

    const data = JSON.parse(result.body);
    const pd = data?.data?.product_summaries?.[0];
    if (!pd) return { status: "UNKNOWN" };

    const availability = pd?.availability;
    const fulfillment = pd?.fulfillment;
    const price = pd?.price?.current_retail;
    const productName = pd?.item?.product_description?.title;
    const productUrl = `https://www.target.com/p/A-${tcin}`;

    let status = "OUT_OF_STOCK";
    let stockCount = null;
    let cartLimit = null;

    const avState = availability?.state;
    const shipStatus = fulfillment?.shipping_options?.availability_status;

    if (avState === "IN_STOCK" || shipStatus === "IN_STOCK") {
      status = "IN_STOCK";
      stockCount = availability?.available_to_promise_quantity || null;
    } else if (avState === "READY_FOR_LAUNCH") {
      status = "READY_FOR_LAUNCH";
    }

    return { status, price, stockCount, cartLimit, productName, productUrl };
  } catch (err) {
    log.error("Target check failed", { product: product.identifier, error: err.message });
    return { status: "UNKNOWN" };
  }
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
      visitor_id: VISITOR_ID,
      zip: "90210",
    });

    const url = `https://redsky.target.com/redsky_aggregations/v1/web/plp_search_v2?${params}`;
    const proxy = null; // Proxy disabled — Railway blocks port 3128

    const result = await proxyFetch(url, {
      headers: getHeaders("redsky.target.com"),
      timeout: 20000,
    }, proxy);

    if (result.status !== 200) return { status: "UNKNOWN" };

    const data = JSON.parse(result.body);
    const items = data?.data?.search?.products || [];
    if (!items.length) return { status: "UNKNOWN" };

    const first = items[0];
    const tcin = first?.tcin;
    const avail = first?.fulfillment?.shipping_options?.availability_status;

    return {
      status: avail === "IN_STOCK" ? "IN_STOCK" : avail === "READY_FOR_LAUNCH" ? "READY_FOR_LAUNCH" : "OUT_OF_STOCK",
      price: first?.price?.current_retail,
      productName: first?.item?.product_description?.title,
      productUrl: `https://www.target.com/p/A-${tcin}`,
      resolvedIdentifier: tcin,
    };
  } catch (err) {
    log.error("Target search failed", { keyword, error: err.message });
    return { status: "UNKNOWN" };
  }
}

module.exports = { checkProduct };
