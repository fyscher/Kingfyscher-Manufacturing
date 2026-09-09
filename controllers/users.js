const usersRouter = require("express").Router();
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const User = require("../models/user");
const { userExtractor } = require("../middleware");
const { hasKingfyscherGong } = require("../utils/kingfyscherGong");
const { sendEmail } = require("../utils/mailer");

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

usersRouter.post("/", async (request, response) => {
  const { username, name, password, email } = request.body;

  if (!username || username.length < 3) {
    return response.status(400).json({ error: "Username too short" });
  }

  if (password.length < 3) {
    return response.status(400).json({ error: "Password too short" });
  }

  const saltRounds = 10;
  const passwordHash = await bcrypt.hash(password, saltRounds);
  const savedUser = await User.create({
    username,
    name,
    passwordHash,
    email: email ? email.trim().toLowerCase() : undefined,
  });

  response.status(201).json(savedUser);
});

usersRouter.post("/forgot-username", async (request, response) => {
  const { name } = request.body;

  if (!name || !name.trim()) {
    return response.status(400).json({ error: "Name is required" });
  }

  const users = await User.find();
  const usernames = users
    .filter((user) => user.name.toLowerCase() === name.trim().toLowerCase())
    .map((user) => user.username);

  response.json({ usernames });
});

usersRouter.post("/forgot-password", async (request, response) => {
  const { email } = request.body;

  if (!email || !email.trim()) {
    return response.status(400).json({ error: "Email is required" });
  }

  const user = await User.findOne({ email: email.trim().toLowerCase() });

  if (user) {
    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
    await User.update(user.id, { resetToken: token, resetTokenExpires: expires });

    const resetUrl = `${request.protocol}://${request.get("host")}/?reset_token=${token}`;
    try {
      await sendEmail({
        to: user.email,
        subject: "Reset your Kingfyscher Manufacturing password",
        html: `<p>Someone requested a password reset for the account <strong>${user.username}</strong>.</p><p><a href="${resetUrl}">Click here to set a new password</a>. This link expires in 1 hour.</p><p>If you didn't request this, you can ignore this email.</p>`,
      });
    } catch (error) {
      console.error("Failed to send password reset email:", error.message);
    }
  }

  response.json({ message: "If that email is registered, a reset link has been sent." });
});

usersRouter.post("/reset-password", async (request, response) => {
  const { token, password } = request.body;

  if (!token) {
    return response.status(400).json({ error: "Reset token is required" });
  }

  if (!password || password.length < 3) {
    return response.status(400).json({ error: "Password too short" });
  }

  const user = await User.findOne({ resetToken: token });

  if (!user || !user.resetTokenExpires || new Date(user.resetTokenExpires) < new Date()) {
    return response.status(400).json({ error: "Invalid or expired reset token" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await User.update(user.id, {
    passwordHash,
    resetToken: null,
    resetTokenExpires: null,
  });

  response.json({ message: "Password updated successfully" });
});

usersRouter.get("/", userExtractor, async (request, response) => {
  const users = await User.find();

  const withFlair = await Promise.all(
    users.map(async (user) => {
      if (!user.uplandUserId) return user;
      const full = await User.findById(user.id);
      const qualifies = await hasKingfyscherGong(full?.uplandAccessToken);
      return { ...user, hasKingfyscherGong: qualifies };
    }),
  );

  response.json(withFlair);
});

usersRouter.delete("/:id", userExtractor, async (request, response) => {
  await User.findByIdAndDelete(request.params.id);
  response.status(204).end();
});

module.exports = usersRouter;
