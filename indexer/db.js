const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

// Raw rows are the source of truth and are never rewritten (INSERT OR IGNORE),
// so a re-run backfill can't double count. Decoded tables are rebuilt from raw
// with INSERT OR REPLACE, so improving a decoder never needs the network.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS raw_actions (
  global_sequence TEXT PRIMARY KEY,
  feed TEXT NOT NULL, trx_id TEXT NOT NULL, block_num INTEGER NOT NULL, ts TEXT NOT NULL,
  contract TEXT NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS raw_actions_feed_ts ON raw_actions (feed, ts);

CREATE TABLE IF NOT EXISTS raw_deltas (
  id TEXT PRIMARY KEY,
  feed TEXT NOT NULL, block_num INTEGER NOT NULL, ts TEXT NOT NULL, code TEXT NOT NULL,
  scope TEXT NOT NULL, table_name TEXT NOT NULL, primary_key TEXT NOT NULL,
  present INTEGER NOT NULL, data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS raw_deltas_feed_ts ON raw_deltas (feed, ts);

CREATE TABLE IF NOT EXISTS nft_sales (
  global_sequence TEXT PRIMARY KEY, trx_id TEXT NOT NULL, ts TEXT NOT NULL, block_num INTEGER NOT NULL,
  buyer TEXT, seller TEXT, price REAL, buyer_paid REAL, fee REAL, currency TEXT,
  dgood_id TEXT, display_name TEXT, category TEXT, mint INTEGER
);
CREATE INDEX IF NOT EXISTS nft_sales_name_ts ON nft_sales (display_name, ts);

CREATE TABLE IF NOT EXISTS property_sales (
  global_sequence TEXT PRIMARY KEY, trx_id TEXT NOT NULL, ts TEXT NOT NULL, block_num INTEGER NOT NULL,
  kind TEXT NOT NULL, property_id TEXT NOT NULL, buyer TEXT, seller TEXT,
  price REAL, currency TEXT, address TEXT
);
CREATE INDEX IF NOT EXISTS property_sales_prop_ts ON property_sales (property_id, ts);

CREATE TABLE IF NOT EXISTS property_listing_events (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, block_num INTEGER NOT NULL, property_id TEXT NOT NULL,
  seller TEXT, price_upx REAL, price_fiat REAL, flags TEXT, present INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS listing_events_prop_ts ON property_listing_events (property_id, ts);

CREATE TABLE IF NOT EXISTS property_offer_events (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, block_num INTEGER NOT NULL, offer_id TEXT NOT NULL,
  property_id TEXT, owner TEXT, offerer TEXT, price REAL, currency TEXT, present INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS designs (
  category TEXT NOT NULL, token_name TEXT NOT NULL, category_name_id TEXT,
  max_supply INTEGER, issued_supply INTEGER, current_supply INTEGER, updated_at TEXT NOT NULL,
  PRIMARY KEY (category, token_name)
);
CREATE TABLE IF NOT EXISTS design_names (
  category_name_id TEXT PRIMARY KEY, display_name TEXT, series_id TEXT, updated_at TEXT NOT NULL
);

-- The live property listing book (chain table t2), replaced on every snapshot.
CREATE TABLE IF NOT EXISTS listings_current (
  property_id TEXT PRIMARY KEY, seller TEXT, price_upx REAL, price_fiat REAL, flags TEXT, snapshot_at TEXT NOT NULL,
  -- Copied from the property catalog when known (enrichListings), so floors are index lookups.
  address TEXT, city_id INTEGER, city_name TEXT, neighborhood_name TEXT, mint_price REAL
);

-- Property catalog from the Developers API (/v2/properties), refreshed per city.
CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY, address TEXT, city_id INTEGER, city_name TEXT, neighborhood_id INTEGER,
  neighborhood_name TEXT, mint_price REAL, status TEXT, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS properties_city ON properties (city_id);

-- Listed properties the Developers API couldn't place, so lookups aren't repeated.
CREATE TABLE IF NOT EXISTS properties_missing (id TEXT PRIMARY KEY, checked_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS sync_state (
  feed TEXT PRIMARY KEY, done_until TEXT NOT NULL, updated_at TEXT NOT NULL
);
`;

// Columns added after a table first shipped; created on older databases at open.
const ADDED_COLUMNS = {
  listings_current: { address: "TEXT", city_id: "INTEGER", city_name: "TEXT", neighborhood_name: "TEXT", mint_price: "REAL" },
};

const INDEXES = `
CREATE INDEX IF NOT EXISTS listings_city_upx ON listings_current (city_id, price_upx);
CREATE INDEX IF NOT EXISTS listings_upx ON listings_current (price_upx);
CREATE INDEX IF NOT EXISTS listings_city_usd ON listings_current (city_id, price_fiat);
`;

function openDb(file) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 30000"); // the tail and a CLI command may write at the same time
  db.exec(SCHEMA);
  for (const [table, cols] of Object.entries(ADDED_COLUMNS)) {
    const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
    for (const [col, type] of Object.entries(cols)) if (!have.has(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
  }
  db.exec(INDEXES);
  return db;
}

const nowIso = () => new Date().toISOString();

function insertRawActions(db, rows) {
  const stmt = db.prepare(`INSERT OR IGNORE INTO raw_actions
    (global_sequence, feed, trx_id, block_num, ts, contract, name, data)
    VALUES (@global_sequence, @feed, @trx_id, @block_num, @ts, @contract, @name, @data)`);
  let added = 0;
  db.transaction(() => {
    for (const r of rows) added += stmt.run({ ...r, data: JSON.stringify(r.data) }).changes;
  })();
  return added;
}

function insertRawDeltas(db, rows) {
  const stmt = db.prepare(`INSERT OR IGNORE INTO raw_deltas
    (id, feed, block_num, ts, code, scope, table_name, primary_key, present, data)
    VALUES (@id, @feed, @block_num, @ts, @code, @scope, @table_name, @primary_key, @present, @data)`);
  let added = 0;
  db.transaction(() => {
    for (const r of rows) added += stmt.run({ ...r, data: JSON.stringify(r.data) }).changes;
  })();
  return added;
}

const parseRows = rows => rows.map(r => ({ ...r, data: JSON.parse(r.data) }));

function rawActions(db, feed, from, to) {
  return parseRows(
    db.prepare("SELECT * FROM raw_actions WHERE feed = ? AND ts >= ? AND ts < ? ORDER BY ts, global_sequence")
      .all(feed, from, to),
  );
}

function rawDeltas(db, feed, from, to) {
  return parseRows(
    db.prepare("SELECT * FROM raw_deltas WHERE feed = ? AND ts >= ? AND ts < ? ORDER BY ts, id").all(feed, from, to),
  );
}

function upsert(db, table, rows) {
  if (rows.length === 0) return 0;
  const cols = Object.keys(rows[0]);
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(c => `@${c}`).join(", ")})`,
  );
  db.transaction(() => {
    for (const r of rows) stmt.run(r);
  })();
  return rows.length;
}

function getCheckpoint(db, feed) {
  return db.prepare("SELECT done_until FROM sync_state WHERE feed = ?").get(feed)?.done_until ?? null;
}

function setCheckpoint(db, feed, doneUntil) {
  db.prepare(`INSERT INTO sync_state (feed, done_until, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(feed) DO UPDATE SET done_until = excluded.done_until, updated_at = excluded.updated_at`)
    .run(feed, doneUntil, nowIso());
}

function stats(db) {
  const tables = ["raw_actions", "raw_deltas", "nft_sales", "property_sales", "property_listing_events",
    "property_offer_events", "designs", "design_names"];
  const counts = Object.fromEntries(tables.map(t => [t, db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]));
  const checkpoints = db.prepare("SELECT feed, done_until FROM sync_state ORDER BY feed").all();
  return { counts, checkpoints };
}

module.exports = {
  openDb,
  nowIso,
  insertRawActions,
  insertRawDeltas,
  rawActions,
  rawDeltas,
  upsert,
  getCheckpoint,
  setCheckpoint,
  stats,
};
