"use strict";

/**
 * seed-target-puppeteer.js
 * Uses Puppeteer to scrape Target search results and load all Pokemon TCG
 * TCINs into the monitor_products table.
 * 
 * Run once locally: node seed-target-puppeteer.js
 * Requires: npm install puppeteer
 */

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const WEBHOOK_URL = process.env.MONITOR_DEFAULT_WEBHOOK;

const SEARCH_PAGES = [
  "https://www.target.com/s?searchTerm=pokemon+trading+card+game",
  "https://www.target.com/s?searchTerm=pokemon+tcg+elite+trainer+box",
  "https://www.target.com/s?searchTerm=pokemon+tcg+booster+pack",
  "https://www.target.com/s?searchTerm=pokemon+tcg+booster+bundle",
  "https://www.target.com/s?searchTerm=pokemon+tcg+collection+box",
  "https://www.target.com/s?searchTerm=pokemon+tcg+tin",
  "https://www.target.com/s?searchTerm=pokemon+tcg+premium+collection",
  "https://www.target.com/c/trading-card-games/-/N-5xt1a",
];

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  let puppeteer;
  try {
    puppeteer = require("puppeteer");
  } catch (e) {
    console.error("Puppeteer not installed. Run: npm install puppeteer");
    process.exit(1);
  }

  console.log("HUMN Target Product Seeder (Puppeteer)");
  console.log("=======================================\n");

  if (!WEBHOOK_URL) {
    console.error("ERROR: MONITOR_DEFAULT_WEBHOOK not set in .env");
    process.exit(1);
  }

  // Get existing TCINs
  const { data: existing } = await supabase
    .from("monitor_products")
    .select("identifier")
    .eq("retailer", "target")
    .eq("active", true);

  const existingTcins = new Set((existing || []).map(p => p.identifier));
  console.log(`Existing monitored products: ${existingTcins.size}\n`);

  // Launch browser
  console.log("Launching browser...");
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  const allTcins = new Map(); // tcin -> name
  const page = await browser.newPage();

  // Set realistic browser headers
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36");
  await page.setExtraHTTPHeaders({
    "Accept-Language": "en-US,en;q=0.9",
  });

  for (const url of SEARCH_PAGES) {
    console.log(`\nScraping: ${url}`);

    try {
      await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

      // Wait for products to render
      await sleep(3000);

      // Scroll down to load more products
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight / 2);
      });
      await sleep(2000);
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await sleep(2000);

      // Extract TCINs from page
      const products = await page.evaluate(() => {
        const results = [];
        const seen = new Set();

        // Method 1: Look for TCINs in data attributes
        document.querySelectorAll("[data-item-id]").forEach(el => {
          const tcin = el.getAttribute("data-item-id");
          if (tcin && /^\d{7,12}$/.test(tcin) && !seen.has(tcin)) {
            seen.add(tcin);
            const nameEl = el.querySelector("[data-test='product-title']") ||
                          el.querySelector("a[aria-label]");
            results.push({ tcin, name: nameEl?.textContent?.trim() || nameEl?.getAttribute("aria-label") || null });
          }
        });

        // Method 2: Look in product links
        document.querySelectorAll("a[href*='/A-']").forEach(el => {
          const match = el.href.match(/\/A-(\d{7,12})/);
          if (match && !seen.has(match[1])) {
            seen.add(match[1]);
            results.push({ tcin: match[1], name: el.getAttribute("aria-label") || el.textContent?.trim()?.slice(0, 100) || null });
          }
        });

        // Method 3: Look in __NEXT_DATA__ or window state
        const scripts = document.querySelectorAll("script[type='application/json'], script#__NEXT_DATA__");
        scripts.forEach(script => {
          try {
            const text = script.textContent;
            const tcinRegex = /"tcin":"(\d{7,12})"/g;
            const nameRegex = /"title":"([^"]{5,150})"/g;
            let m;
            const tcinList = [];
            while ((m = tcinRegex.exec(text)) !== null) {
              if (!seen.has(m[1])) {
                seen.add(m[1]);
                tcinList.push(m[1]);
              }
            }
            tcinList.forEach(tcin => {
              results.push({ tcin, name: null });
            });
          } catch (e) {}
        });

        return results;
      });

      console.log(`  Found ${products.length} products`);
      products.forEach(p => {
        if (!allTcins.has(p.tcin)) {
          allTcins.set(p.tcin, p.name);
        }
      });

    } catch (err) {
      console.log(`  Error: ${err.message}`);
    }

    await sleep(2000);
  }

  await browser.close();
  console.log(`\nTotal unique TCINs found: ${allTcins.size}`);

  if (allTcins.size === 0) {
    console.log("No TCINs found. Target may be blocking headless browsers.");
    console.log("Try running with headless: false to see what's happening.");
    process.exit(0);
  }

  // Add to Supabase
  let added = 0;
  let skipped = 0;

  for (const [tcin, name] of allTcins) {
    if (existingTcins.has(tcin)) {
      skipped++;
      continue;
    }

    const { error } = await supabase
      .from("monitor_products")
      .upsert({
        retailer: "target",
        identifier: tcin,
        identifier_type: "tcin",
        product_name: name || null,
        webhook_url: WEBHOOK_URL,
        active: true,
        last_status: null,
      }, { onConflict: "retailer,identifier" });

    if (error) {
      console.log(`  ERROR adding ${tcin}: ${error.message}`);
    } else {
      console.log(`  + Added: ${name?.slice(0, 60) || tcin}`);
      added++;
    }

    await sleep(50);
  }

  console.log(`\nDone!`);
  console.log(`  Added: ${added} new products`);
  console.log(`  Skipped: ${skipped} already monitored`);
  console.log(`  Total now watching: ${existingTcins.size + added}`);
  process.exit(0);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
