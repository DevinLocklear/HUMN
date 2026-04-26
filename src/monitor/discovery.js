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
  "sec-ch-ua": '"Chromium";v="122"',
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-site",
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/**
 * Search Target for Pokemon TCG products and return TCINs
 */
async function searchTarget(keyword) {
  try {
    // Use Target's main search page — more reliable than redsky API
    const url = `https://www.target.com/s?searchTerm=${encodeURIComponent(keyword)}&category=5xt1a&type=products`;

    const webshareProxy = {
      host: process.env.PROXY_HOST || "p.webshare.io",
      port: parseInt(process.env.PROXY_PORT || "80"),
      user: process.env.PROXY_USER || "xnqyxvyg-GB-1",
      pass: process.env.PROXY_PASS || "j2prfly8xpvf",
    };

    const headers = {
      "User-Agent": UA,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://www.target.com/",
      "Host": "www.target.com",
    };

    let result = await proxyFetch(url, { headers, timeout: 15000 }, webshareProxy);

    if (!result || result.status !== 200) {
      result = await proxyFetch(url, { headers, timeout: 15000 }, null);
    }

    if (!result || result.status !== 200) {
      log.warn("Target search non-OK", { keyword, status: result?.status });
      return [];
    }

    // Extract all TCINs from the page HTML
    const tcinMatches = result.body.matchAll(/"tcin":"(\d{7,12})"/g);
    const tcins = new Set();
    const products = [];

    for (const match of tcinMatches) {
      const tcin = match[1];
      if (!tcins.has(tcin)) {
        tcins.add(tcin);
        // Try to extract product name near this TCIN
        const idx = result.body.indexOf(match[0]);
        const nearby = result.body.slice(Math.max(0, idx - 500), idx + 500);
        const nameMatch = nearby.match(/"title":"([^"]{5,150})"/);
        products.push({
          tcin,
          name: nameMatch ? nameMatch[1] : null,
          url: `https://www.target.com/p/A-${tcin}`,
        });
      }
    }

    log.info("Target search found products", { keyword, count: products.length });
    return products;
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
