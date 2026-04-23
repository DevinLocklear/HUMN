"use strict";

/**
 * src/monitor/retailers/target.js
 * Monitors Target for restocks using their current API.
 */

const { createLogger } = require("../../logger");
const { proxyFetch } = require("../fetch");

const log = createLogger("monitor:target");

async function checkProduct(product) {
  try {
    if (product.identifier_type === "keyword") {
      return await searchByKeyword(product.identifier);
    }

    const tcin = product.identifier;

    // Try multiple API endpoints in order
    const result = await tryEndpoints(tcin);
    return result;
  } catch (err) {
    log.error("Target check failed", { product: product.identifier, error: err.message });
    return { status: "UNKNOWN" };
  }
}

async function tryEndpoints(tcin) {
  const endpoints = [
    // Endpoint 1: v3 pdp (simplest, most stable)
    {
      url: `https://redsky.target.com/v3/pdp/tcin/${tcin}?key=9f36aeafbe60771e321a7cc95a78140772ab3e96&excludes=taxonomy,promotion,bulk_ship,rating_and_review_reviews,rating_and_review_statistics,question_answer_statistics`,
      host: "redsky.target.com",
    },
    // Endpoint 2: product details v4
    {
      url: `https://redsky.target.com/v4/product/detail?key=9f36aeafbe60771e321a7cc95a78140772ab3e96&tcin=${tcin}&store_id=911`,
      host: "redsky.target.com",
    },
    // Endpoint 3: Target's public product page (scrape JSON-LD)
    {
      url: `https://www.target.com/p/A-${tcin}`,
      host: "www.target.com",
      scrape: true,
    },
  ];

  for (const endpoint of endpoints) {
    try {
      const result = await proxyFetch(endpoint.url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept": endpoint.scrape ? "text/html,application/xhtml+xml" : "application/json",
          "Accept-Language": "en-US,en;q=0.9",
          "Referer": "https://www.target.com/",
          "Host": endpoint.host,
        },
        timeout: 20000,
      }, null);

      log.info("Target endpoint tried", { url: endpoint.url.slice(0, 80), status: result.status });

      if (result.status !== 200) continue;

      if (endpoint.scrape) {
        return parseTargetPage(result.body, tcin);
      }

      const data = JSON.parse(result.body);
      const parsed = parseTargetResponse(data, tcin);
      if (parsed.status !== "UNKNOWN") return parsed;
    } catch (err) {
      log.warn("Target endpoint failed", { error: err.message });
      continue;
    }
  }

  return { status: "UNKNOWN" };
}

function parseTargetResponse(data, tcin) {
  // Try various response shapes
  const product = data?.data?.product || data?.product || data?.data?.product_summaries?.[0];
  if (!product) return { status: "UNKNOWN" };

  const avail =
    product?.availability?.availability_status ||
    product?.availability?.state ||
    product?.children?.[0]?.availability?.availability_status ||
    "OUT_OF_STOCK";

  const price =
    product?.price?.current_retail ||
    product?.children?.[0]?.price?.current_retail ||
    null;

  const productName = product?.item?.product_description?.title || null;

  const inStock = avail === "IN_STOCK";
  const isLaunch = avail === "READY_FOR_LAUNCH";

  return {
    status: inStock ? "IN_STOCK" : isLaunch ? "READY_FOR_LAUNCH" : "OUT_OF_STOCK",
    price,
    productName,
    productUrl: `https://www.target.com/p/A-${tcin}`,
  };
}

function parseTargetPage(html, tcin) {
  try {
    // Look for __TGT_DATA__ or __NEXT_DATA__ in the page
    const tgtMatch = html.match(/__TGT_DATA__\s*=\s*(\{.*?\});/s);
    const nextMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);

    if (nextMatch) {
      const data = JSON.parse(nextMatch[1]);
      const product = data?.props?.pageProps?.["@type"] === "Product" ? data?.props?.pageProps : null;
      if (product) {
        const inStock = product?.offers?.availability === "http://schema.org/InStock";
        return {
          status: inStock ? "IN_STOCK" : "OUT_OF_STOCK",
          price: product?.offers?.price || null,
          productName: product?.name || null,
          productUrl: `https://www.target.com/p/A-${tcin}`,
        };
      }
    }

    // Check for "In Stock" text as fallback
    const inStockText = html.includes('"availability_status":"IN_STOCK"') || html.includes('"inStock":true');
    const outOfStockText = html.includes('"availability_status":"OUT_OF_STOCK"');

    if (inStockText) return { status: "IN_STOCK", productUrl: `https://www.target.com/p/A-${tcin}` };
    if (outOfStockText) return { status: "OUT_OF_STOCK", productUrl: `https://www.target.com/p/A-${tcin}` };

    return { status: "UNKNOWN" };
  } catch (err) {
    return { status: "UNKNOWN" };
  }
}

async function searchByKeyword(keyword) {
  try {
    const url = `https://www.target.com/s?searchTerm=${encodeURIComponent(keyword)}`;
    const result = await proxyFetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Host": "www.target.com",
      },
      timeout: 20000,
    }, null);

    if (result.status !== 200) return { status: "UNKNOWN" };

    // Extract first TCIN from search results
    const tcinMatch = result.body.match(/"tcin":"(\d+)"/);
    if (!tcinMatch) return { status: "UNKNOWN" };

    const tcin = tcinMatch[1];
    return await tryEndpoints(tcin);
  } catch (err) {
    log.error("Target search failed", { keyword, error: err.message });
    return { status: "UNKNOWN" };
  }
}

module.exports = { checkProduct };
