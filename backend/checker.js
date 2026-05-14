require("dotenv").config();
const cron = require("node-cron");
const db = require("./db");
const { extractProduct } = require("./scraper");
const { sendPriceAlert } = require("./email");

let isRunning = false;

function log(msg) {
  console.log(`[${new Date().toISOString()}] [checker] ${msg}`);
}

// Scrapes one item, updates the DB, and sends an alert if conditions are met.
// Returns a result object so the manual-check API endpoint can report back.
async function checkItem(item) {
  const result = await extractProduct(item.url, item.size);
  const now = new Date().toISOString();

  db.prepare(
    `
    UPDATE watched_items SET last_checked_price = ?, last_checked_at = ? WHERE id = ?
  `,
  ).run(result.price, now, item.id);

  log(
    `${item.product_name}: price=$${result.price}, ` +
      `size "${item.size}" available=${result.sizeAvailable}`,
  );

  const priceDropped =
    result.price != null && result.price <= item.target_price;
  const sizeAvailable = result.sizeAvailable;

  let alerted = false;
  if (item.status === "watching" && priceDropped && sizeAvailable) {
    log(
      `ALERT: "${item.product_name}" is $${result.price} (target $${item.target_price}), size "${item.size}" in stock`,
    );

    await sendPriceAlert({
      productName: item.product_name,
      price: result.price,
      targetPrice: item.target_price,
      size: item.size,
      url: item.url,
      imageUrl: item.product_image_url,
      siteName: item.site_name,
    });

    db.prepare("UPDATE watched_items SET status = 'alerted' WHERE id = ?").run(
      item.id,
    );
    alerted = true;
  }

  return { scraped: result, priceDropped, sizeAvailable, alerted };
}

async function runCheck() {
  if (isRunning) {
    log("Already running — skipping this tick");
    return;
  }

  isRunning = true;
  log("Starting price check cycle");

  const items = db
    .prepare("SELECT * FROM watched_items WHERE status = 'watching'")
    .all();
  log(`Checking ${items.length} item(s)`);

  for (const item of items) {
    log(`Checking: ${item.product_name || item.url}`);
    try {
      await checkItem(item);
    } catch (err) {
      log(`ERROR on item ${item.id} (${item.url}): ${err.message}`);
    }
  }

  isRunning = false;
  log("Check cycle complete");
}

function startScheduler() {
  cron.schedule("0 * * * *", () => {
    runCheck().catch((err) => {
      console.error(`[checker] Unhandled error in runCheck: ${err.message}`);
      isRunning = false;
    });
  });
  log("Scheduled — runs every hour");
}

module.exports = { checkItem, runCheck, startScheduler };
