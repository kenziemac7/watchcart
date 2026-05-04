require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'watchcart.db'));

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS watched_items (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    url               TEXT NOT NULL,
    site_name         TEXT,
    product_name      TEXT,
    product_image_url TEXT,
    original_price    REAL,
    target_price      REAL NOT NULL,
    size              TEXT,
    last_checked_price REAL,
    last_checked_at   TEXT,
    status            TEXT NOT NULL DEFAULT 'watching'
                        CHECK(status IN ('watching', 'alerted', 'paused')),
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

module.exports = db;
