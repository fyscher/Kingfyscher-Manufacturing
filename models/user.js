const { randomUUID } = require("crypto");

const users = [];

const strip = (u) => ({
  id: u.id,
  username: u.username,
  name: u.name,
  ...(u.uplandUserId ? { uplandUserId: u.uplandUserId } : {}),
  ...(u.uplandConnectedAt ? { uplandConnectedAt: u.uplandConnectedAt } : {}),
});

const User = {
  async findById(id) {
    return users.find((u) => u.id === id) ?? null;
  },

  async findOne(filter) {
    return (
      users.find((u) =>
        Object.entries(filter).every(([k, v]) => u[k] === v)
      ) ?? null
    );
  },

  async find() {
    return users.map(strip);
  },

  async create(fields) {
    const user = { id: randomUUID(), ...fields };
    users.push(user);
    return strip(user);
  },

  async findByIdAndDelete(id) {
    const idx = users.findIndex((u) => u.id === id);
    if (idx !== -1) users.splice(idx, 1);
  },

  async deleteMany() {
    users.length = 0;
  },

  async update(id, fields) {
    const user = users.find((u) => u.id === id);
    if (!user) throw new Error("User not found");
    Object.assign(user, fields);
    return { ...user };
  },
};

module.exports = User;
