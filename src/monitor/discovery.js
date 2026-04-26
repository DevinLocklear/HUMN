"use strict";

/**
 * src/monitor/discovery.js
 * Auto-discovers new Pokemon TCG products on Target every 5 minutes.
 * Adds any new TCINs to monitor_products automatically.
 */

const { createLogger } = require("../logger");
const { supabase } = require("../config");
const { proxyFetch } = require("./fetch");
const { getProxy } = require("./proxy");

const log = createLogger("monitor:discovery");

const DISCOVERY_INTERVAL = 5 * 60 * 1000; // 5 minutes

// Default webhook URL for auto-discovered products
// Falls back to MONITOR_DEFAULT_WEBHOOK env var
function getDefaultWebhook() {
  return process.env.MONITOR_DEFAULT_WEBHOOK || null;
}

// Target search queries for Pokemon TCG
const TARGET_QUERIES = [
  "Pokemon Trading Card Game",
  "Pokemon TCG booster",
  "Pokemon TCG elite trainer",
  "Pokemon TCG collection",
  "Pokemon TCG tin",
];

const TARGET_HEADERS = {
  "Accept": "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://www.target.com/",
  "Host": "redsky.target.com",
};

/**
 * Search Target for Pokemon TCG products and return TCINs
 */
async function searchTarget(keyword) {
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
      pricing_store_id: "911",
    });

    const url = `https://redsky.target.com/redsky_aggregations/v1/web/plp_search_v2?${params}`;

    const webshareProxy = {
      host: process.env.PROXY_HOST || "p.webshare.io",
      port: parseInt(process.env.PROXY_PORT || "80"),
      user: process.env.PROXY_USER || "xnqyxvyg-GB-1",
      pass: process.env.PROXY_PASS || "j2prfly8xpvf",
    };

    let result = await proxyFetch(url, {
      headers: TARGET_HEADERS,
      timeout: 10000,
    }, webshareProxy);

    // Fallback to direct if proxy fails
    if (!result || result.status === 0 || result.status >= 500) {
      result = await proxyFetch(url, { headers: TARGET_HEADERS, timeout: 10000 }, null);
    }

    if (result.status !== 200) {
      log.warn("Target search non-OK", { keyword, status: result.status });
      return [];
    }

    const data = JSON.parse(result.body);
    const items = data?.data?.search?.products || [];

    return items.map(item => ({
      tcin: item?.tcin,
      name: item?.item?.product_description?.title,
      price: item?.price?.current_retail,
      status: item?.availability_status || item?.fulfillment?.shipping_options?.availability_status || "UNKNOWN",
      url: item?.tcin ? `https://www.target.com/p/A-${item.tcin}` : null,
      seller: item?.item?.seller?.name || item?.fulfillment?.shipping_options?.fulfillment_type || "",
    })).filter(p => {
      if (!p.tcin) return false;
      // Skip 3rd party / marketplace sellers
      const s = (p.seller || "").toLowerCase();
      if (s === "marketplace" || s === "3p") return false;
      if (p.seller && s !== "target" && s !== "") return false;
      return true;
    });
  } catch (err) {
    log.warn("Target search failed", { keyword, error: err.message });
    return [];
  }
}

/**
 * Get all currently monitored TCINs from the database
 */
async function getMonitoredTcins() {
  const { data } = await supabase
    .from("monitor_products")
    .select("identifier")
    .eq("retailer", "target")
    .eq("active", true);

  return new Set((data || []).map(p => p.identifier));
}

/**
 * Add a new product to the monitor
 */
async function addProduct(tcin, name, webhookUrl) {
  const { error } = await supabase
    .from("monitor_products")
    .upsert({
      retailer: "target",
      identifier: tcin,
      identifier_type: "tcin",
      product_name: name || null,
      webhook_url: webhookUrl,
      active: true,
      last_status: null,
    }, { onConflict: "retailer,identifier" });

  if (error) {
    log.error("Failed to add discovered product", { tcin, error: error.message });
    return false;
  }

  log.info("New product discovered and added", { tcin, name });
  return true;
}

/**
 * Run one discovery cycle
 */
async function discoveryCycle() {
  const webhookUrl = getDefaultWebhook();
  if (!webhookUrl) {
    log.warn("No MONITOR_DEFAULT_WEBHOOK set — skipping discovery");
    return;
  }

  log.info("Discovery cycle started");

  // Get existing monitored TCINs
  const monitoredTcins = await getMonitoredTcins();

  // Search Target with all queries
  const found = new Map(); // tcin -> product info

  for (const query of TARGET_QUERIES) {
    const products = await searchTarget(query);
    for (const p of products) {
      if (p.tcin && !found.has(p.tcin)) {
        found.set(p.tcin, p);
      }
    }
    // Small delay between searches
    await sleep(2000);
  }

  log.info("Discovery search complete", { found: found.size, monitored: monitoredTcins.size });

  // Add any new products
  let added = 0;
  for (const [tcin, product] of found) {
    if (!monitoredTcins.has(tcin)) {
      const success = await addProduct(tcin, product.name, webhookUrl);
      if (success) added++;
      await sleep(200);
    }
  }

  if (added > 0) {
    log.info(`Discovery added ${added} new products to monitor`);
  } else {
    log.info("Discovery complete — no new products found");
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let discoveryTimer = null;

/**
 * Start the discovery loop
 */
function startDiscovery() {
  log.info("HUMN Discovery starting — scanning Target every 5 minutes");

  // Initial scan after 30 seconds
  setTimeout(discoveryCycle, 30000);

  // Then every 5 minutes
  discoveryTimer = setInterval(discoveryCycle, DISCOVERY_INTERVAL);
}

/**
 * Stop discovery
 */
function stopDiscovery() {
  if (discoveryTimer) {
    clearInterval(discoveryTimer);
    discoveryTimer = null;
  }
}

module.exports = { startDiscovery, stopDiscovery, discoveryCycle };
