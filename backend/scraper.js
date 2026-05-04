require('dotenv').config();
const { Stagehand } = require('@browserbasehq/stagehand');
const { z } = require('zod');

// Common close-button selectors across major retail sites.
// Playwright tries these first (fast + deterministic) before falling back
// to the Stagehand LLM for anything unusual.
const POPUP_CLOSE_SELECTORS = [
  'button[aria-label*="close" i]',
  'button[aria-label*="dismiss" i]',
  'button[aria-label*="no thanks" i]',
  '[data-testid*="close" i]',
  '[data-testid*="modal-close" i]',
  '[class*="CloseButton"]',
  '[class*="closeButton"]',
  '[class*="close-btn"]',
  '[class*="modal-close"]',
  '[class*="popup-close"]',
  '[class*="overlay-close"]',
  '[class*="dialog-close"]',
  '[class*="ModalClose"]',
  'button[class*="dismiss"]',
];

async function dismissPopups(page, stagehand) {
  await page.waitForTimeout(2_500);

  for (const sel of POPUP_CLOSE_SELECTORS) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 300 })) {
        await el.click();
        await page.waitForTimeout(500);
        return;
      }
    } catch {}
  }

  // Nothing matched — hand off to Stagehand to visually find it
  await stagehand.act(
    'If a popup, modal, email signup form, or overlay is covering the page, close it by clicking the X, close, or "No thanks" button.'
  ).catch(() => {});
}

async function scrapeProduct(url, targetSize = null) {
  const stagehand = new Stagehand({
    env: 'BROWSERBASE',
    model: 'anthropic/claude-sonnet-4-6',
    browserbaseSessionCreateParams: {
      proxies: true,
      browserSettings: {
        fingerprint: {
          browsers: ['chrome'],
          devices: ['desktop'],
          locales: ['en-US'],
          operatingSystems: ['macos'],
        },
      },
    },
  });

  try {
    await stagehand.init();
    const page = stagehand.context.pages()[0];

    await page.goto(url, { waitUntil: 'domcontentloaded', timeoutMs: 30_000 });
    await page.waitForLoadState('networkidle', { timeoutMs: 10_000 }).catch(() => {});

    // og:image lives in <head> and is unaffected by overlays — grab it now
    const ogImage = await page.evaluate(() => {
      const el = document.querySelector('meta[property="og:image"]');
      return el ? el.getAttribute('content') : null;
    }).catch(() => null);

    await dismissPopups(page, stagehand);

    const product = await stagehand.extract(
      'Extract the product name and current displayed price.',
      z.object({
        productName: z.string().describe('full name or title of the product'),
        price: z.number().nullable().describe('current price in USD as a plain number, e.g. 59.95'),
      })
    );

    let sizeAvailable = true;
    if (targetSize) {
      try {
        await stagehand.act(`click the "${targetSize}" size option`);

        const { available } = await stagehand.extract(
          `After selecting size ${targetSize}, is this size available to add to the cart? ` +
          'Return false if the page shows "Sold Out", "Out of Stock", "Unavailable", or a waitlist prompt.',
          z.object({
            available: z.boolean().describe('true if the size is in stock and can be added to cart'),
          })
        );

        sizeAvailable = available;
      } catch (err) {
        console.log(`[scraper] Size check failed for "${targetSize}": ${err.message}`);
        sizeAvailable = true;
      }
    }

    return {
      price:          product.price != null ? parseFloat(product.price.toFixed(2)) : null,
      productName:    product.productName ?? 'Unknown Product',
      imageUrl:       ogImage,
      sizeAvailable,
      siteName:       new URL(url).hostname.replace('www.', ''),
      availableSizes: [],
    };
  } finally {
    await stagehand.close().catch(() => {});
  }
}

module.exports = { scrapeProduct };
