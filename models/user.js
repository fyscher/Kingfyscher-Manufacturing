const Database = require("better-sqlite3");
const path = require("path");
const { randomUUID } = require("crypto");

const db = new Database(path.join(__dirname, "../dev.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    upland_user_id TEXT,
    upland_access_token TEXT,
    upland_connected_at TEXT,
    upland_connection_code TEXT
  )
`);

const strip = (row) => {
  if (!row) return null;
  const obj = { id: row.id, username: row.username, name: row.name };
  if (row.upland_user_id) obj.uplandUserId = row.upland_user_id;
  if (row.upland_connected_at) obj.uplandConnectedAt = row.upland_connected_at;
  return obj;
};

const toFull = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    passwordHash: row.password_hash,
    uplandUserId: row.upland_user_id ?? undefined,
    uplandAccessToken: row.upland_access_token ?? undefined,
    uplandConnectedAt: row.upland_connected_at ?? undefined,
    uplandConnectionCode: row.upland_connection_code ?? undefined,
  };
};

const User = {
  async findById(id) {
    return toFull(db.prepare("SELECT * FROM users WHERE id = ?").get(id));
  },

  async findOne(filter) {
    const [col, val] = Object.entries(filter)[0];
    const colMap = {
      username: "username",
      uplandConnectionCode: "upland_connection_code",
      uplandUserId: "upland_user_id",
    };
    const col2 = colMap[col] || col;
    return toFull(db.prepare(`SELECT * FROM users WHERE ${col2} = ?`).get(val));
  },

  async find() {
    return db.prepare("SELECT * FROM users").all().map(strip);
  },

  async create(fields) {
    const id = randomUUID();
    db.prepare(`
      INSERT INTO users (id, username, name, password_hash)
      VALUES (?, ?, ?, ?)
    `).run(id, fields.username, fields.name, fields.passwordHash);
    return strip(db.prepare("SELECT * FROM users WHERE id = ?").get(id));
  },

  async findByIdAndDelete(id) {
    db.prepare("DELETE FROM users WHERE id = ?").run(id);
  },

  async deleteMany() {
    db.prepare("DELETE FROM users").run();
  },

  async update(id, fields) {
    const colMap = {
      uplandUserId: "upland_user_id",
      uplandAccessToken: "upland_access_token",
      uplandConnectedAt: "upland_connected_at",
      uplandConnectionCode: "upland_connection_code",
    };
    const sets = Object.keys(fields)
      .map((k) => `${colMap[k] || k} = ?`)
      .join(", ");
    const vals = Object.values(fields);
    db.prepare(`UPDATE users SET ${sets} WHERE id = ?`).run(...vals, id);
    return toFull(db.prepare("SELECT * FROM users WHERE id = ?").get(id));
  },
};

module.exports = User;
