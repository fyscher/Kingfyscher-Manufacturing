const supabase = require("../utils/supabase");

const FIELD_MAP = {
  username: "username",
  name: "name",
  passwordHash: "password_hash",
  uplandUserId: "upland_user_id",
  uplandAccessToken: "upland_access_token",
  uplandConnectedAt: "upland_connected_at",
  uplandConnectionCode: "upland_connection_code",
};

const toSnake = (obj) => {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const col = FIELD_MAP[key];
    if (col && value !== undefined) result[col] = value;
  }
  return result;
};

const toCamel = (row) => {
  if (!row) return null;
  const obj = { id: row.id, username: row.username, name: row.name };
  if (row.upland_user_id) obj.uplandUserId = row.upland_user_id;
  if (row.upland_connected_at) obj.uplandConnectedAt = row.upland_connected_at;
  return obj;
};

const toCamelFull = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    passwordHash: row.password_hash,
    uplandUserId: row.upland_user_id,
    uplandAccessToken: row.upland_access_token,
    uplandConnectedAt: row.upland_connected_at,
    uplandConnectionCode: row.upland_connection_code,
  };
};

const User = {
  async findById(id) {
    const { data, error } = await supabase
      .from("users")
      .select()
      .eq("id", id)
      .single();
    if (error) return null;
    return toCamelFull(data);
  },

  async findOne(filter) {
    const snaked = toSnake(filter);
    let query = supabase.from("users").select();
    for (const [col, value] of Object.entries(snaked)) {
      query = query.eq(col, value);
    }
    const { data, error } = await query.single();
    if (error) return null;
    return toCamelFull(data);
  },

  async find() {
    const { data, error } = await supabase.from("users").select();
    if (error) throw error;
    return data.map(toCamel);
  },

  async create(fields) {
    const snaked = toSnake(fields);
    const { data, error } = await supabase
      .from("users")
      .insert(snaked)
      .select()
      .single();
    if (error) throw error;
    return toCamel(data);
  },

  async findByIdAndDelete(id) {
    const { error } = await supabase.from("users").delete().eq("id", id);
    if (error) throw error;
  },

  async deleteMany() {
    const { error } = await supabase
      .from("users")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) throw error;
  },

  async update(id, fields) {
    const snaked = toSnake(fields);
    const { data, error } = await supabase
      .from("users")
      .update(snaked)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return toCamelFull(data);
  },
};

module.exports = User;
