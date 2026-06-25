const User = require('../models/user')

const Fyscher =
{
    "username": "fyscher",
    "name": "fyscher",
    "password": "testy"
}

const Fyschman =
{
    "username": "Fyschman",
    "name": "Fyschman",
    "password": "testerrr"
}

const usersInDb = async () =>
{
    return await User.find()
}

module.exports =
{
    usersInDb,
    Fyscher,
    Fyschman
}
