require('dotenv').config();
const express = require('express');
const db = require('./db');
const { scrapeProduct } = require('./scraper');
const { checkItem, runCheck, startScheduler } = require('./checker');

const app = express();
app.use(express.json());

// Allow requests from the Chrome extension (localhost and chrome-extension://)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ─── Health ──────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ─── List items ──────────────────────────────────────────────────────────────

app.get('/items', (_req, res) => {
  const items = db.prepare(
    'SELECT * FROM watched_items ORDER BY created_at DESC'
  ).all();
  res.json(items);
});

// ─── Add item ────────────────────────────────────────────────────────────────

app.post('/items', async (req, res) => {
  const { url, target_price, size } = req.body;

  if (!url || target_price == null) {
    return res.status(400).json({ error: 'url and target_price are required' });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const targetPrice = parseFloat(target_price);
  if (isNaN(targetPrice) || targetPrice <= 0) {
    return res.status(400).json({ error: 'target_price must be a positive number' });
  }

  console.log(`[server] Scraping new item: ${parsedUrl.href}`);

  let scraped;
  try {
    scraped = await scrapeProduct(parsedUrl.href);
  } catch (err) {
    console.error('[server] Scrape failed:', err.message);
    return res.status(502).json({ error: `Scrape failed: ${err.message}` });
  }

  const result = db.prepare(`
    INSERT INTO watched_items
      (url, site_name, product_name, product_image_url, original_price, target_price, size)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    parsedUrl.href,
    scraped.siteName,
    scraped.productName,
    scraped.imageUrl,
    scraped.price,
    targetPrice,
    size?.trim() || null
  );

  const item = db.prepare('SELECT * FROM watched_items WHERE id = ?')
    .get(result.lastInsertRowid);

  res.status(201).json(item);
});

// ─── Delete item ─────────────────────────────────────────────────────────────

app.delete('/items/:id', (req, res) => {
  const result = db.prepare('DELETE FROM watched_items WHERE id = ?')
    .run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// ─── Update item ─────────────────────────────────────────────────────────────

app.patch('/items/:id', (req, res) => {
  const { target_price, size, status } = req.body;
  const fields = [];
  const values = [];

  if (target_price != null) {
    const v = parseFloat(target_price);
    if (isNaN(v) || v <= 0) return res.status(400).json({ error: 'Invalid target_price' });
    fields.push('target_price = ?');
    values.push(v);
  }
  if (size !== undefined) {
    fields.push('size = ?');
    values.push(size?.trim() || null);
  }
  if (status !== undefined) {
    if (!['watching', 'alerted', 'paused'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    fields.push('status = ?');
    values.push(status);
  }

  if (fields.length === 0) return res.status(400).json({ error: 'Nothing to update' });

  values.push(req.params.id);
  const result = db.prepare(
    `UPDATE watched_items SET ${fields.join(', ')} WHERE id = ?`
  ).run(...values);

  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });

  const item = db.prepare('SELECT * FROM watched_items WHERE id = ?')
    .get(req.params.id);
  res.json(item);
});

// ─── Manual check ────────────────────────────────────────────────────────────

app.post('/items/:id/check', async (req, res) => {
  const item = db.prepare('SELECT * FROM watched_items WHERE id = ?')
    .get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });

  let result;
  try {
    result = await checkItem(item);
  } catch (err) {
    return res.status(502).json({ error: `Scrape failed: ${err.message}` });
  }

  const updated = db.prepare('SELECT * FROM watched_items WHERE id = ?').get(item.id);
  res.json({ item: updated, ...result });
});

// ─── Start ───────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[server] WatchCart running on http://localhost:${PORT}`);
  startScheduler();
});
