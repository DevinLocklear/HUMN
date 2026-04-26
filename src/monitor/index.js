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
    const result = await retailerModule.checkProduct(product);

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
 * Run one full poll cycle across all active products
 */
async function pollCycle() {
  if (isRunning) {
    log.warn("Monitor poll already running, skipping");
    return;
  }

  isRunning = true;
  const products = await getAllActiveProducts();

  if (!products.length) {
    isRunning = false;
    return;
  }

  log.info("Monitor poll cycle started", { count: products.length });

  // Check products with small delays to avoid rate limiting
  for (const product of products) {
    await checkProduct(product);
    await sleep(500); // 500ms between each check
  }

  log.info("Monitor poll cycle complete", { count: products.length });
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

  // Then poll every 30 seconds
  pollTimer = setInterval(pollCycle, 30 * 1000);

  log.info("HUMN Monitor running — polling every 60 seconds");
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
