const Database = require("better-sqlite3");
const path = require("path");
const { randomUUID } = require("crypto");
const config = require("../utils/config");

const db = new Database(config.DB_PATH || path.join(__dirname, "../dev.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    email TEXT,
    reset_token TEXT,
    reset_token_expires TEXT,
    upland_user_id TEXT,
    upland_access_token TEXT,
    upland_connected_at TEXT,
    upland_connection_code TEXT
  )
`);

for (const migration of [
  "ALTER TABLE users ADD COLUMN email TEXT",
  "ALTER TABLE users ADD COLUMN reset_token TEXT",
  "ALTER TABLE users ADD COLUMN reset_token_expires TEXT",
]) {
  try {
    db.exec(migration);
  } catch (error) {
    if (!/duplicate column name/i.test(error.message)) throw error;
  }
}

const strip = (row) => {
  if (!row) return null;
  const obj = { id: row.id, username: row.username, name: row.name };
  if (row.email) obj.email = row.email;
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
    email: row.email ?? undefined,
    resetToken: row.reset_token ?? undefined,
    resetTokenExpires: row.reset_token_expires ?? undefined,
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
      email: "email",
      resetToken: "reset_token",
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
      INSERT INTO users (id, username, name, password_hash, email)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, fields.username, fields.name, fields.passwordHash, fields.email || null);
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
      passwordHash: "password_hash",
      resetToken: "reset_token",
      resetTokenExpires: "reset_token_expires",
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
