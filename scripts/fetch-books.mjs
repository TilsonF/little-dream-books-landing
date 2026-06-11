#!/usr/bin/env node
/**
 * fetch-books.mjs
 * ---------------
 * Reads src/data/asins.json, fetches Amazon product pages for each book
 * using the primaryAsin, extracts metadata (title, cover, price, description)
 * via OG tags + cheerio, and writes the result to src/data/books.json.
 *
 * Designed to run once per day via GitHub Actions.
 * No API keys needed. No headless browser. No proxies.
 *
 * Usage:
 *   node scripts/fetch-books.mjs
 */

import axios from "axios";
import * as cheerio from "cheerio";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASINS_PATH  = join(__dirname, "../src/data/asins.json");
const OUTPUT_PATH = join(__dirname, "../src/data/books.json");

// ─── HTTP client ────────────────────────────────────────────────────────────

const http = axios.create({
  timeout: 20000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/124.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,es;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    Referer: "https://www.google.com/",
    DNT: "1",
  },
});

// ─── Sleep helper ────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Price extractor ─────────────────────────────────────────────────────────

function extractPrice($) {
  // Kindle / ebook price
  const kindlePrice = $(".kindle-price .a-color-price, #kindle-price").first().text().trim();
  if (kindlePrice) return kindlePrice;

  // "Buy new" price
  const buyBox = $(".buybox-button-price, #corePrice_feature_div .a-offscreen, #price_inside_buybox").first().text().trim();
  if (buyBox) return buyBox;

  // Generic
  const generic = $(".a-price .a-offscreen").first().text().trim();
  return generic || "";
}

// ─── Rating extractor ────────────────────────────────────────────────────────

function extractRating($) {
  const ratingEl = $("span[data-hook='rating-out-of-text'], #acrPopover").first();
  const ratingText = ratingEl.attr("title") || ratingEl.text().trim();
  const stars = ratingText.match(/[\d.,]+/)?.[0] || "";

  const countEl = $("span[data-hook='total-review-count'], #acrCustomerReviewText").first();
  const countText = countEl.text().trim();
  const reviews = countText.replace(/[^0-9,]/g, "").replace(",", "") || "";

  return { stars, reviews };
}

// ─── Cover URL ───────────────────────────────────────────────────────────────

function extractCover($, asin) {
  // OG image (most reliable)
  const og = $('meta[property="og:image"]').attr("content") || "";
  if (og) {
    // Upscale: replace size token with SL500
    return og.replace(/\._[A-Z]{2}\d+_\./, "._SL500_.");
  }

  // Main product image
  const mainImg = $("#imgBlkFront, #ebooksImgBlkFront, #landingImage")
    .attr("data-a-dynamic-image") || "";
  if (mainImg) {
    const urls = Object.keys(JSON.parse(mainImg));
    if (urls.length) return urls[0].replace(/\._[A-Z]{2}\d+_\./, "._SL500_.");
  }

  // Fallback: known Amazon product image CDN pattern
  return `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._SL500_.jpg`;
}

// ─── Description ─────────────────────────────────────────────────────────────

function extractDescription($) {
  // OG description
  const og = $('meta[property="og:description"]').attr("content") || "";
  if (og && og.length > 40) return og.slice(0, 400);

  // Editorial description
  const editorial = $("#bookDescription_feature_div span, #iframeContent").text().trim();
  if (editorial) return editorial.slice(0, 400);

  // Fallback: meta description
  const meta = $('meta[name="description"]').attr("content") || "";
  return meta.slice(0, 400);
}

// ─── Fetch one ASIN ──────────────────────────────────────────────────────────

async function fetchAsin(asin, lang = "en") {
  const url =
    lang === "es"
      ? `https://www.amazon.com/-/es/dp/${asin}`
      : `https://www.amazon.com/dp/${asin}`;

  console.log(`  ↳ GET ${url}`);

  const response = await http.get(url);
  const $ = cheerio.load(response.data);

  // Check if Amazon served a bot/captcha page
  const bodyText = $("body").text().toLowerCase();
  if (bodyText.includes("robot check") || bodyText.includes("captcha")) {
    throw new Error("Amazon served a CAPTCHA — retry later");
  }

  const title =
    $('meta[property="og:title"]').attr("content") ||
    $("#productTitle").text().trim() ||
    $('meta[name="twitter:title"]').attr("content") ||
    "";

  return {
    asin,
    title: title.replace(/ - Kindle edition.*$/i, "").trim(),
    coverUrl: extractCover($, asin),
    description: extractDescription($),
    price: extractPrice($),
    ...extractRating($),
    amazonUrl: `https://www.amazon.com/dp/${asin}`,
    fetchedAt: new Date().toISOString(),
  };
}

// ─── Build edition buttons data ───────────────────────────────────────────────

function buildEditions(editionConfig, fetchedData) {
  const result = {};

  for (const [lang, formats] of Object.entries(editionConfig)) {
    result[lang] = {};
    for (const [format, asin] of Object.entries(formats)) {
      if (!asin) continue;
      const data = fetchedData[asin] || {};
      result[lang][format] = {
        asin,
        price: data.price || "",
        amazonUrl: `https://www.amazon.com/dp/${asin}`,
      };
    }
  }

  return result;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("📚 Little Dream Books — Amazon Book Fetcher");
  console.log("============================================\n");

  const config = JSON.parse(readFileSync(ASINS_PATH, "utf-8"));
  const { authorId, authorName, authorUrl, books: bookConfigs } = config;

  // Collect all unique ASINs we need to fetch
  const allAsins = new Set();
  for (const book of bookConfigs) {
    allAsins.add(book.primaryAsin);
    for (const formats of Object.values(book.editions || {})) {
      for (const asin of Object.values(formats)) {
        if (asin) allAsins.add(asin);
      }
    }
  }

  // Load existing data so we can merge (preserves data if one request fails)
  let existingFetched = {};
  if (existsSync(OUTPUT_PATH)) {
    try {
      const existing = JSON.parse(readFileSync(OUTPUT_PATH, "utf-8"));
      for (const book of existing.books || []) {
        // Re-index by ASIN for quick lookup
        if (book._raw) {
          for (const [asin, data] of Object.entries(book._raw)) {
            existingFetched[asin] = data;
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // Fetch each ASIN with a delay to be polite
  const fetchedData = { ...existingFetched };
  let successCount = 0;
  let failCount = 0;

  for (const asin of allAsins) {
    try {
      // Random delay 3-7s between requests — looks human, avoids rate limiting
      const delay = 3000 + Math.floor(Math.random() * 4000);
      if (successCount > 0 || failCount > 0) {
        console.log(`  ⏳ Waiting ${Math.round(delay / 1000)}s...\n`);
        await sleep(delay);
      }

      const data = await fetchAsin(asin);
      fetchedData[asin] = data;
      successCount++;
      console.log(`  ✅ ${asin} → "${data.title.slice(0, 60)}" ${data.price ? `(${data.price})` : ""}`);
    } catch (err) {
      failCount++;
      console.warn(`  ⚠️  ${asin} failed: ${err.message}`);
      // Keep existing data for this ASIN if available
      if (existingFetched[asin]) {
        console.log(`     Using cached data from previous run.`);
      }
    }
  }

  // Build final output
  const outputBooks = bookConfigs.map((bookConfig) => {
    const primary = fetchedData[bookConfig.primaryAsin] || {};

    return {
      id: bookConfig.id,
      tag: bookConfig.tag || "",
      tagColor: bookConfig.tagColor || "chip-lavender",
      isNew: bookConfig.isNew || false,

      // Main metadata from primary ASIN (English paperback by default)
      title: primary.title || "",
      coverUrl: primary.coverUrl || "",
      description: primary.description || "",
      stars: primary.stars || "",
      reviews: primary.reviews || "",

      // Edition breakdown: { en: { paperback, ebook, hardcover }, es: {...} }
      editions: buildEditions(bookConfig.editions || {}, fetchedData),

      // Raw fetched data per ASIN (for debugging / future use)
      _raw: Object.fromEntries(
        Object.entries(fetchedData).filter(([asin]) => {
          const allBookAsins = [
            bookConfig.primaryAsin,
            ...Object.values(bookConfig.editions || {}).flatMap((f) =>
              Object.values(f)
            ),
          ];
          return allBookAsins.includes(asin);
        })
      ),
    };
  });

  const output = {
    authorId,
    authorName,
    authorUrl,
    lastUpdated: new Date().toISOString(),
    fetchStats: { successCount, failCount, total: allAsins.size },
    books: outputBooks,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

  console.log("\n─────────────────────────────────────────────");
  console.log(`✅ Done! ${successCount}/${allAsins.size} ASINs fetched successfully.`);
  console.log(`📄 Output: ${OUTPUT_PATH}`);

  if (failCount > 0) {
    console.warn(`⚠️  ${failCount} ASIN(s) failed — cached data used where available.`);
  }

  // Exit with error only if ALL requests failed
  if (successCount === 0) {
    console.error("\n❌ All requests failed. Amazon may be blocking GitHub Actions IPs today.");
    console.error("   The site will use data from the previous run.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\n❌ Fatal error:", err.message);
  process.exit(1);
});
