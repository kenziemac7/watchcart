# WatchCart

Price-drop alert app. Add products from any retailer, set a target price + size, and get an email the moment the item hits your price **and** your size is in stock.

```
User adds item (extension)
       ↓
Backend scrapes page via Browserbase  →  stores in SQLite
       ↓
Cron checks every hour via Browserbase
       ↓
Price ≤ target AND size available?  →  Resend email alert
```

---

## Stack

| Layer | Tech |
|---|---|
| Backend | Node.js + Express |
| Database | SQLite (better-sqlite3) |
| Browser automation | Browserbase + Playwright |
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

> Playwright connects to Browserbase over CDP — no local browser download needed.
> If npm tries to download browsers anyway, run:
> `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install`

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
pm2 logs watchcart       # live logs
pm2 restart watchcart    # after editing code or .env
pm2 stop watchcart       # pause
pm2 status               # check it's running
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

1. Navigate to any product page (Amazon, Nike, Madewell, Anthropologie, etc.)
2. Click the WatchCart icon — a banner appears: **"Looks like a shopping page"**
3. Click **Add to WatchCart**, set your target price and size, click **Watch This Item**
4. The backend immediately scrapes the page via Browserbase to get the product name, image, and current price
5. The checker runs **every hour** and re-scrapes all watched items
6. When `price ≤ target` AND your size is available → email alert fires and status flips to `alerted`
7. To re-enable alerts after a price drop, send `PATCH /items/:id` with `{ "status": "watching" }`

To manually trigger a check right now:
```bash
curl -X POST http://localhost:3000/items/1/check
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

Every page visit goes through a **real Browserbase cloud browser session** with residential proxy rotation and a macOS Chrome fingerprint. This means:

- JavaScript-rendered prices load correctly
- Sessions look like real user traffic to anti-bot systems
- Redirects and client-side navigation are handled before scraping

### Price extraction (in priority order)

1. **`schema.org` JSON-LD** — `<script type="application/ld+json">` with `offers.price`
2. **Meta tags** — `product:price:amount`, `name="price"`, `itemprop="price"`
3. **CSS selector probe** — ranked list covering Amazon, Nike, ASOS, and generic patterns

### Size availability check

The checker uses a **click-based approach** that works across retailers without site-specific selectors:

1. Find the size element on the page (buttons, list items, or select dropdowns) matching the saved size
2. Check static attributes first (`disabled`, `aria-disabled`, class names like `sold-out`)
3. If not statically disabled: click the size element and snapshot the page text before vs. after
4. If phrases like `"sold out"`, `"out of stock"`, or `"unavailable"` newly appear after clicking → size is unavailable
5. If no size selector is found at all → assume available (logs a warning)

### Adding site-specific overrides

Open `backend/scraper.js` and find the `OVERRIDES` object. Add an entry keyed on the hostname:

```js
async function scrapeNike(page) {
  const price = await page.$eval(
    '[data-testid="product-price"]',
    el => parseFloat(el.textContent.replace(/[^0-9.]/g, ''))
  );
  const productName = await page.$eval('h1', el => el.textContent.trim());
  const imageUrl    = await page.$eval('meta[property="og:image"]', el => el.content);
  // availableSizes is informational only — size gating uses isSizeAvailable()
  return { price, productName, imageUrl, availableSizes: [] };
}

const OVERRIDES = { 'nike.com': scrapeNike };
```

---

## Known limitations

- **Heavy bot-protection sites** (Cloudflare-gated stores, Ticketmaster, etc.) may still block even with residential proxies. `ERR_HTTP2_PROTOCOL_ERROR` from these sites retries up to 3 times automatically.
- **Size format is substring-matched** — if the site shows `"10.5 US"` and you enter `"10.5"` it will match. If the site uses EU sizing, enter that format instead (e.g. `"44"`).
- **Alerted items stop being checked** to prevent repeat emails. Reset via `PATCH /items/:id { "status": "watching" }`.
- **Single recipient** — `ALERT_TO_EMAIL` in `.env` is one address. Multi-user support would require a `email` column per item.
- **No API authentication** — the backend is localhost-only by design. Don't expose port 3000 publicly without adding auth.
