"use strict";

/**
 * src/monitor/index.js
 * Clean monitor — polls active products every 30 seconds in parallel.
 * Designed for a small curated watch list of ~20 hyped products.
 */

const { createLogger } = require("../logger");
const { getAllActiveProducts, updateProductStatus } = require("./db");
const { sendRestockAlert } = require("./webhook");

const log = createLogger("monitor");

const RETAILERS = {
  target: require("./retailers/target"),
  walmart: require("./retailers/walmart"),
  pokemoncenter: require("./retailers/pokemoncenter"),
};

let isRunning = false;
let pollTimer = null;

async function checkProduct(product) {
  const retailerKey = (product.retailer || "").toLowerCase().replace(/\s/g, "");
  const retailerModule = RETAILERS[retailerKey];

  if (!retailerModule) return;

  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Product check timed out")), 15000)
    );
    const result = await Promise.race([retailerModule.checkProduct(product), timeoutPromise]);

    if (result.status === "UNKNOWN") return;

    const previousStatus = product.last_status;
    const newStatus = result.status;

    await updateProductStatus({
      id: product.id,
      status: newStatus,
      price: result.price,
      stockCount: result.stockCount,
      productName: result.productName,
      productUrl: result.productUrl,
    });

    const shouldAlert =
      (previousStatus !== "IN_STOCK" && newStatus === "IN_STOCK") ||
      (previousStatus === null && newStatus === "READY_FOR_LAUNCH") ||
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

async function pollCycle() {
  if (isRunning) return;

  isRunning = true;
  const products = await getAllActiveProducts();

  if (!products.length) {
    isRunning = false;
    return;
  }

  log.info("Poll cycle", { count: products.length });

  // Check all products in parallel
  await Promise.all(products.map(product => checkProduct(product)));

  isRunning = false;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function startMonitor() {
  log.info("HUMN Monitor starting — polling every 30 seconds");
  setTimeout(pollCycle, 5000);
  pollTimer = setInterval(pollCycle, 30 * 1000);
}

function stopMonitor() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

module.exports = { startMonitor, stopMonitor, pollCycle, checkProduct };
