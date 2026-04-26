"use strict";

/**
 * src/monitor/index.js
 * Main monitor polling engine.
 * Polls all active products and fires Discord alerts on status changes.
 */

const { createLogger } = require("../logger");
const { getAllActiveProducts, updateProductStatus } = require("./db");
const { sendRestockAlert } = require("./webhook");

const log = createLogger("monitor");

// Polling intervals per retailer (ms)
const POLL_INTERVALS = {
  pokemoncenter: 45 * 1000,  // 45 seconds
  target: 60 * 1000,          // 60 seconds
  walmart: 60 * 1000,         // 60 seconds
  gamestop: 90 * 1000,        // 90 seconds
  amazon: 120 * 1000,         // 2 minutes
  general: 60 * 1000,
};

// Retailer modules
const RETAILERS = {
  target: require("./retailers/target"),
  walmart: require("./retailers/walmart"),
  pokemoncenter: require("./retailers/pokemoncenter"),
};

let isRunning = false;
let pollTimer = null;

/**
 * Check a single product and fire alert if status changed
 */
async function checkProduct(product) {
  const retailerKey = (product.retailer || "").toLowerCase().replace(/\s/g, "");
  const retailerModule = RETAILERS[retailerKey];

  if (!retailerModule) {
    log.warn("No retailer module for", { retailer: product.retailer });
    return;
  }

  try {
    // Hard 15s timeout per product — prevents one product from blocking the whole cycle
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Product check timed out")), 15000)
    );
    const result = await Promise.race([retailerModule.checkProduct(product), timeoutPromise]);

    if (result.status === "UNKNOWN") return;

    const previousStatus = product.last_status;
    const newStatus = result.status;

    // Update DB with latest status
    await updateProductStatus({
      id: product.id,
      status: newStatus,
      price: result.price,
      stockCount: result.stockCount,
      productName: result.productName,
      productUrl: result.productUrl,
    });

    // Fire alert if status changed meaningfully
    const shouldAlert =
      (previousStatus !== "IN_STOCK" && newStatus === "IN_STOCK") || // Restock or new launch
      (previousStatus === null && newStatus === "READY_FOR_LAUNCH") || // New pre-launch product
      (previousStatus === "UNKNOWN" && newStatus === "IN_STOCK");

    if (shouldAlert && product.webhook_url) {
      log.info("Status changed — firing alert", {
        product: product.product_name || product.identifier,
        from: previousStatus,
        to: newStatus,
        retailer: product.retailer,
      });

      await sendRestockAlert({
        webhookUrl: product.webhook_url,
        product: {
          ...product,
          product_name: result.productName || product.product_name,
          product_url: result.productUrl || product.product_url,
        },
        status: newStatus,
        previousStatus,
        price: result.price,
        stockCount: result.stockCount,
        cartLimit: result.cartLimit,
        imageUrl: result.imageUrl || null,
      });
    }
  } catch (err) {
    log.error("Product check failed", { product: product.identifier, error: err.message });
  }
}

/**
 * Determine polling tier based on product status and last checked time
 * Tier 1 (hot): 30s — recently changed or null status
 * Tier 2 (warm): 5min — out of stock but checked recently
 * Tier 3 (cold): 30min — stable out of stock for a while
 */
/**
 * Is it currently peak restock hours?
 * Target restocks: 12 AM - 8 AM EST
 * Walmart restocks: 12 AM - 6 AM EST
 */
function isPeakHours() {
  const now = new Date();
  // Convert to EST
  const estHour = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })).getHours();
  return estHour >= 0 && estHour < 8;
}

function getProductTier(product) {
  // During peak hours — everything is hot
  if (isPeakHours()) return 1;

  const now = Date.now();
  const lastChecked = product.last_checked_at ? new Date(product.last_checked_at).getTime() : 0;
  const minutesSinceCheck = (now - lastChecked) / 60000;

  // Never checked or status is null — hot
  if (!product.last_checked_at || !product.last_status) return 1;

  // In stock or ready for launch — always hot
  if (product.last_status === "IN_STOCK" || product.last_status === "READY_FOR_LAUNCH") return 1;

  // Status recently changed — warm
  if (minutesSinceCheck < 30) return 2;

  // Stable out of stock — cold
  return 3;
}

/**
 * Run one full poll cycle across all active products
 * Uses tiered polling to save bandwidth
 */
async function pollCycle() {
  if (isRunning) {
    log.warn("Monitor poll already running, skipping");
    return;
  }

  isRunning = true;
  const allProducts = await getAllActiveProducts();

  if (!allProducts.length) {
    isRunning = false;
    return;
  }

  const now = Date.now();

  // Filter products based on tier timing
  const products = allProducts.filter(product => {
    const tier = getProductTier(product);
    const lastChecked = product.last_checked_at ? new Date(product.last_checked_at).getTime() : 0;
    const secondsSince = (now - lastChecked) / 1000;

    if (tier === 1) return secondsSince >= 30;   // Check every 30s
    if (tier === 2) return secondsSince >= 300;  // Check every 5min
    if (tier === 3) return secondsSince >= 1800; // Check every 30min
    return true;
  });

  const hot = allProducts.filter(p => getProductTier(p) === 1).length;
  const warm = allProducts.filter(p => getProductTier(p) === 2).length;
  const cold = allProducts.filter(p => getProductTier(p) === 3).length;

  if (!products.length) {
    isRunning = false;
    return;
  }

  log.info("Monitor poll cycle started", { 
    checking: products.length, 
    total: allProducts.length,
    hot, warm, cold 
  });

  // Check due products in parallel batches of 10
  const BATCH_SIZE = 10;
  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const batch = products.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(product => checkProduct(product)));
    if (i + BATCH_SIZE < products.length) await sleep(500);
  }

  log.info("Monitor poll cycle complete", { checked: products.length });
  isRunning = false;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Start the monitor polling loop
 */
function startMonitor() {
  log.info("HUMN Monitor starting...");

  // Initial poll after 10 seconds
  setTimeout(pollCycle, 10000);

  // Poll every 30 seconds — all products checked in parallel
  pollTimer = setInterval(pollCycle, 30 * 1000);

  log.info("HUMN Monitor running — polling every 30 seconds (fully parallel)");
}

/**
 * Stop the monitor
 */
function stopMonitor() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  log.info("HUMN Monitor stopped");
}

module.exports = { startMonitor, stopMonitor, pollCycle, checkProduct };
