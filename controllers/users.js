const usersRouter = require("express").Router();
const bcrypt = require("bcrypt");
const User = require("../models/user");
const { userExtractor } = require("../middleware");

usersRouter.post("/", async (request, response) => {
  const { username, name, password } = request.body;

  if (password.length < 3) {
    return response.status(400).json({ error: "Password too short" });
  }

  const saltRounds = 10;
  const passwordHash = await bcrypt.hash(password, saltRounds);
  const savedUser = await User.create({ username, name, passwordHash });

  response.status(201).json(savedUser);
});

usersRouter.get("/", userExtractor, async (request, response) => {
  const users = await User.find();
  response.json(users);
});

usersRouter.delete("/:id", userExtractor, async (request, response) => {
  await User.findByIdAndDelete(request.params.id);
  response.status(204).end();
});

module.exports = usersRouter;
