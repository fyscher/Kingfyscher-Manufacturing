// Read-only handle on the indexer's SQLite database (see indexer/README.md).
// The app only reads; the indexer process is the single writer. Returns null
// when this server has no indexer database (e.g. the Fly deployment).
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DB_PATH = process.env.INDEXER_DB_PATH || path.join(__dirname, "..", "data", "indexer.db");
let db;

function indexerDb() {
  if (db) return db;
  if (!fs.existsSync(DB_PATH)) return null;
  db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  return db;
}

module.exports = { indexerDb };
