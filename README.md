# WatchCart

Price-drop alert app. Add products from any retailer, set a target price + size, and get an email the moment the item hits your price **and** your size is in stock.

```
User adds item (Chrome extension)
       ↓
Backend scrapes page via Stagehand + Browserbase  →  stores in SQLite
       ↓
Cron checks every hour
       ↓
Price ≤ target AND size available?  →  Resend email alert
```

---

## Stack

| Layer | Tech |
|---|---|
| Backend | Node.js + Express |
| Database | SQLite (better-sqlite3) |
| Browser automation | Stagehand + Browserbase |
| Email | Resend |
| Frontend | Chrome Extension (MV3) |
| Scheduler | node-cron (every hour) |

---

## Setup

### 1. Install dependencies

```bash
cd watchcart/backend
npm install
```

If you get a `NODE_MODULE_VERSION` error for `better-sqlite3`, rebuild it for your current Node version:
```bash
npm rebuild better-sqlite3
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in:

| Variable | Where to get it |
|---|---|
| `BROWSERBASE_API_KEY` | [browserbase.com](https://www.browserbase.com) → Settings → API Keys |
| `BROWSERBASE_PROJECT_ID` | Browserbase dashboard → your project → Settings |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) → API Keys |
| `RESEND_API_KEY` | [resend.com](https://resend.com) → API Keys |
| `RESEND_FROM_EMAIL` | `WatchCart <onboarding@resend.dev>` works on the free tier with no domain setup |
| `ALERT_TO_EMAIL` | Your email address |
| `PORT` | Leave as `3000` unless something conflicts |

### 3. Start the backend (keep-alive with pm2)

```bash
npm install -g pm2
pm2 start server.js --name watchcart
pm2 save
pm2 startup   # follow the printed command to auto-start on reboot
```

Useful commands:
```bash
pm2 status               # check it's running
pm2 logs watchcart       # live logs (price checks, alerts, errors)
pm2 restart watchcart    # after editing code or .env
pm2 stop watchcart       # pause
```

Or run directly for development:
```bash
node server.js
```

### 4. Load the Chrome extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `watchcart/extension/` folder
5. The WatchCart 🛒 icon appears in your toolbar

After any changes to extension files, go back to `chrome://extensions` and click the **↺ refresh icon** on the WatchCart card.

---

## How to use

1. Navigate to any product page (Gap, Madewell, Anthropologie, Nike, etc.)
2. Click the WatchCart icon — a banner appears: **"Looks like a shopping page"**
3. Click **Add to WatchCart**, set your target price and size, click **Watch This Item**
4. The backend immediately scrapes the page via Stagehand to get the product name, image, and current price
5. The checker runs **every hour** and re-scrapes all watched items
6. When `price ≤ target` AND your size is available → email alert fires and status flips to `alerted`
7. To re-enable alerts after a price drop: `PATCH /items/:id` with `{ "status": "watching" }`

To manually trigger a check right now:
```bash
curl -X POST http://localhost:3000/items/:id/check
```

---

## REST API

```
GET    /health            → { status: 'ok' }
GET    /items             → array of all watched items
POST   /items             → add item; body: { url, target_price, size? }
DELETE /items/:id         → remove item
PATCH  /items/:id         → update { target_price?, size?, status? }
POST   /items/:id/check   → manually trigger a full check (scrape + alert if qualified)
```

---

## How the scraper works

Every product page is visited by a real **Browserbase** cloud browser session — with residential proxy rotation and a macOS Chrome fingerprint — powered by **Stagehand**, Browserbase's AI browser automation library.

### Price + product data

Stagehand's `extract()` uses an LLM with a typed Zod schema to pull structured data from the page regardless of the site's markup:

```js
const product = await stagehand.extract(
  'Extract the product name and current displayed price.',
  z.object({
    productName: z.string(),
    price: z.number().nullable(),
  })
);
```

No CSS selectors. No JSON-LD parsing. Works on any retailer.

### Popup dismissal

Before extracting, the scraper waits for email signup modals and cookie banners to appear, then dismisses them using common close-button selectors. If none match, Stagehand's `act()` visually finds and closes the overlay:

```js
await stagehand.act('close any popup or modal covering the page');
```

### Size availability

The scraper clicks the target size using `act()`, then asks the LLM whether the page is signalling it's sold out:

```js
await stagehand.act(`click the "${targetSize}" size option`);

const { available } = await stagehand.extract(
  `After selecting size ${targetSize}, is this size available to add to cart?`,
  z.object({ available: z.boolean() })
);
```

---

## Personal use disclaimer

WatchCart is intended for personal use only — monitoring a handful of items for your own shopping. Please be respectful of retailers' servers and ToS. This is not intended for mass scraping, bulk monitoring, or commercial use.

---

## Known limitations

- **Heavy bot-protection sites** (Cloudflare-gated stores, etc.) may still block even with residential proxies.
- **Size format** — enter the size exactly as it appears on the site (e.g. `S`, `10.5`, `EU 44`). Stagehand matches it visually so it's flexible, but an exact match is most reliable.
- **Alerted items stop being checked** to prevent repeat emails. Reset via `PATCH /items/:id { "status": "watching" }`.
- **Single recipient** — `ALERT_TO_EMAIL` in `.env` is one address. Multi-user support would require an `email` column per item.
- **No API authentication** — the backend is localhost-only by design. Don't expose port 3000 publicly without adding auth.
