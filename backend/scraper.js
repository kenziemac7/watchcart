require('dotenv').config();
const { chromium } = require('playwright');

const BB_API_KEY = process.env.BROWSERBASE_API_KEY;
const BB_PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID;

async function createSession() {
  const res = await fetch('https://api.browserbase.com/v1/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-BB-API-Key': BB_API_KEY,
    },
    body: JSON.stringify({
      projectId: BB_PROJECT_ID,
      proxies: true,
      browserSettings: {
        fingerprint: {
          browsers: ['chrome'],
          devices: ['desktop'],
          locales: ['en-US'],
          operatingSystems: ['macos'],
        },
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Browserbase session creation failed (${res.status}): ${text}`);
  }

  return res.json();
}

// General-purpose DOM scraper. Works by probing common patterns found across
// most e-commerce sites. Add site-specific overrides below when a retailer's
// markup doesn't match these heuristics.
async function extractPageData(page) {
  return page.evaluate(() => {
    // --- Price ---
    let price = null;

    // 1. schema.org JSON-LD (most reliable when present)
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const json = JSON.parse(script.textContent);
        const nodes = Array.isArray(json) ? json : [json];
        for (const node of nodes) {
          const offers = node.offers;
          if (!offers) continue;
          const raw = Array.isArray(offers) ? offers[0]?.price : offers.price;
          if (raw != null) { price = parseFloat(raw); break; }
        }
        if (price != null) break;
      } catch {}
    }

    // 2. Open Graph / standard meta tags
    if (price == null) {
      const meta = document.querySelector(
        'meta[property="product:price:amount"], meta[name="price"], meta[itemprop="price"]'
      );
      if (meta) price = parseFloat(meta.content);
    }

    // 3. Common CSS selectors — ordered from most specific to most generic.
    //    Add site-specific selectors here to override for known retailers.
    if (price == null) {
      const priceSelectors = [
        // Amazon
        '.a-price .a-offscreen',
        '#corePrice_feature_div .a-offscreen',
        // Nike / Adidas style
        '[data-testid="product-price"]',
        '[data-testid="currentPrice"]',
        // Generic schema microdata
        '[itemprop="price"]',
        // Common class patterns
        '.pdp-price__current',
        '.product__price',
        '.product-price',
        '.offer-price',
        '.sale-price',
        '.current-price',
        '.price-current',
        '#price',
        '.price',
        // data attributes
        '[data-price]',
        '[data-product-price]',
        '[data-automation="buybox-price"]',
      ];
      for (const sel of priceSelectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const raw = el.getAttribute('content')
          ?? el.getAttribute('data-price')
          ?? el.getAttribute('data-product-price')
          ?? el.textContent;
        const num = parseFloat(raw.replace(/[^0-9.]/g, ''));
        if (!isNaN(num) && num > 0) { price = num; break; }
      }
    }

    // --- Product name ---
    let productName = null;
    const nameSelectors = [
      'h1[itemprop="name"]',
      '#productTitle',                        // Amazon
      '[data-testid="product-title"]',
      '[data-automation="product-title"]',
      'h1.product-title',
      'h1.product-name',
      'h1.pdp-title',
      'h1',
    ];
    for (const sel of nameSelectors) {
      const el = document.querySelector(sel);
      if (el?.textContent?.trim()) { productName = el.textContent.trim().slice(0, 200); break; }
    }

    // --- Product image ---
    let imageUrl = null;
    const imgSelectors = [
      'meta[property="og:image"]',
      '#landingImage',                        // Amazon
      '[data-testid="product-image"] img',
      '[data-testid="hero-image"] img',
      '.product-image--featured img',
      '.pdp-image img',
      '.primary-image img',
      '.product__media img',
      'img[itemprop="image"]',
    ];
    for (const sel of imgSelectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      imageUrl = el.getAttribute('content') || el.getAttribute('src');
      if (imageUrl && !imageUrl.startsWith('data:')) break;
    }

    // --- Available sizes ---
    // Look for clickable size elements that are NOT disabled/unavailable.
    // Site-specific overrides can target the exact selector for known retailers.
    let availableSizes = [];

    const sizeSelectors = [
      // Nike
      '[data-testid="size-selector"] button:not([disabled]):not([aria-disabled="true"])',
      // ASOS / general
      '.size-selector button:not(.disabled):not([disabled]):not([aria-disabled="true"])',
      '[class*="sizeOption"]:not([class*="unavailable"]):not([class*="disabled"]):not([disabled])',
      '[class*="SizeButton"]:not([class*="Unavailable"]):not([disabled])',
      // data-attribute patterns
      '[data-size]:not([disabled]):not([aria-disabled="true"])',
      // li-based selectors
      'ul.sizes li:not(.unavailable):not(.out-of-stock):not(.disabled)',
      '[class*="size-list"] li:not([class*="unavailable"]):not([class*="disabled"])',
      // select dropdowns
      'select[name*="size"] option:not([disabled])',
      'select[id*="size"] option:not([disabled])',
    ];

    for (const sel of sizeSelectors) {
      const els = document.querySelectorAll(sel);
      if (els.length === 0) continue;
      const found = Array.from(els)
        .map(el => (el.textContent || el.getAttribute('data-size') || el.value || '').trim())
        .filter(Boolean);
      if (found.length > 0) { availableSizes = found; break; }
    }

    return { price, productName, imageUrl, availableSizes };
  });
}

// Site-specific scraper overrides go here. Return null to fall back to the
// general extractor above.
//
// Example:
// async function scrapeNike(page) {
//   return { price, productName, imageUrl, availableSizes };
// }
// const OVERRIDES = { 'nike.com': scrapeNike };
const OVERRIDES = {};

// Sold-out signal phrases to look for after clicking a size.
const SOLD_OUT_PHRASES = [
  'sold out',
  'out of stock',
  'unavailable',
  'not available',
  'temporarily out',
  'currently unavailable',
  'add to waitlist',
  'join waitlist',
  'notify me',
];

// Click-based size availability check. Works across retailers because the
// universal pattern is: click a size → if sold-out text newly appears, it's
// unavailable. Falls back to static DOM attribute checks if a click isn't
// possible, and returns true (assume available) if no size selector is found.
async function isSizeAvailable(page, targetSize) {
  if (!targetSize) return true;
  const target = targetSize.toLowerCase().trim();

  // Selectors that produce one element per size option (buttons and list items)
  const elementSelectors = [
    '[data-testid*="size"] button',
    '[data-testid*="Size"] button',
    '[class*="SizeButton"]',
    '[class*="sizeButton"]',
    '[class*="size-btn"]',
    '[class*="size__item"]',
    '[class*="size-option"]',
    '[class*="sizeOption"]',
    '[class*="size-tile"]',
    '[class*="sizeTile"]',
    '[class*="size-swatch"]',
    '[class*="size-selector"] button',
    '[class*="sizeSelector"] button',
    '[class*="size-list"] li',
    '[class*="sizeList"] li',
    'ul.sizes li',
    '[aria-label*="size"] button',
    'button[data-size]',
    'button[data-value]',
    '[class*="size"] button',
    '[class*="Size"] button',
  ];

  for (const selector of elementSelectors) {
    let elements;
    try { elements = await page.$$(selector); } catch { continue; }
    if (elements.length === 0) continue;

    // Find the element whose visible text / data attributes match the target
    let match = null;
    for (const el of elements) {
      try {
        const text  = ((await el.textContent()) ?? '').trim().toLowerCase();
        const dSize = ((await el.getAttribute('data-size'))  ?? '').toLowerCase();
        const dVal  = ((await el.getAttribute('data-value')) ?? '').toLowerCase();
        if (text.includes(target) || dSize.includes(target) || dVal.includes(target)) {
          match = el; break;
        }
      } catch { continue; }
    }
    if (!match) continue;

    // Fast path: static disabled / unavailable class/attribute check
    const staticDisabled = await match.evaluate(el => {
      const cls = (el.className || '').toLowerCase();
      return (
        el.disabled ||
        el.getAttribute('aria-disabled') === 'true' ||
        cls.includes('disabled') ||
        cls.includes('unavailable') ||
        cls.includes('out-of-stock') ||
        cls.includes('outofstock') ||
        cls.includes('sold-out') ||
        cls.includes('soldout') ||
        cls.includes('notavailable')
      );
    }).catch(() => false);

    if (staticDisabled) return false;

    // Click the size and detect whether "sold out" text newly appears.
    // We snapshot the page text before clicking so transient background
    // messages (e.g. a different size already marked sold out) don't
    // produce a false negative.
    try {
      const textBefore = await page.evaluate(() =>
        document.body.innerText.toLowerCase()
      );

      await match.scrollIntoViewIfNeeded();
      await match.click({ timeout: 4_000 });
      await page.waitForTimeout(1_200);

      const textAfter = await page.evaluate(() =>
        document.body.innerText.toLowerCase()
      );

      const soldOutAppeared = SOLD_OUT_PHRASES.some(
        phrase => !textBefore.includes(phrase) && textAfter.includes(phrase)
      );

      return !soldOutAppeared;
    } catch {
      // Click failed (element covered, navigation, etc.) — trust static check
      return true;
    }
  }

  // Try select dropdowns
  try {
    const select = await page.$('select[name*="size" i], select[id*="size" i], select[class*="size" i]');
    if (select) {
      const options = await select.$$('option');
      for (const opt of options) {
        const text  = ((await opt.textContent()) ?? '').toLowerCase();
        const value = ((await opt.getAttribute('value')) ?? '').toLowerCase();
        if (text.includes(target) || value.includes(target)) {
          return !(await opt.evaluate(el => el.disabled));
        }
      }
    }
  } catch {}

  // No size selector found — can't determine, assume available
  console.log(`[scraper] No size selector found for "${targetSize}", assuming available`);
  return true;
}

async function scrapeProduct(url, targetSize = null) {
  const session = await createSession();
  const wsUrl = `wss://connect.browserbase.com?apiKey=${BB_API_KEY}&sessionId=${session.id}`;

  let browser;
  try {
    browser = await chromium.connectOverCDP(wsUrl);
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? await context.newPage();

    // ERR_HTTP2_PROTOCOL_ERROR is a transient connection reset common on
    // retailer sites with aggressive bot detection. Retry up to 3 times.
    for (let attempt = 1; ; attempt++) {
      try {
        await page.goto(url, { waitUntil: 'load', timeout: 45_000 });
        break;
      } catch (err) {
        if (attempt >= 3 || !err.message.includes('ERR_HTTP2_PROTOCOL_ERROR')) throw err;
        await new Promise(r => setTimeout(r, 1500 * attempt));
      }
    }

    // Wait for network to go idle (catches redirects, client-side navigation,
    // cookie banners that trigger another navigation, etc.). Short timeout is
    // intentional — if it doesn't settle in 8s, we proceed anyway.
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});

    const hostname = new URL(url).hostname.replace('www.', '');
    const overrideFn = Object.entries(OVERRIDES).find(([k]) => hostname.includes(k))?.[1];

    // Retry once if the context is destroyed mid-evaluate (e.g. a late redirect)
    let data;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        data = await (overrideFn ? overrideFn(page) : extractPageData(page));
        break;
      } catch (err) {
        if (attempt === 2 || !err.message.includes('Execution context was destroyed')) throw err;
        // Page navigated under us — wait for it to settle and retry
        await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => {});
        await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
      }
    }

    // Check target size availability while the session is still open
    const sizeAvailable = await isSizeAvailable(page, targetSize);

    return {
      price: data.price != null ? parseFloat(data.price.toFixed(2)) : null,
      productName: data.productName ?? 'Unknown Product',
      imageUrl: data.imageUrl ?? null,
      availableSizes: data.availableSizes ?? [],
      siteName: hostname,
      sizeAvailable,
    };
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}

module.exports = { scrapeProduct };
