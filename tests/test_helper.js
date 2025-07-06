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
    const users = await User.find({})
    return users.map(u => u.toJSON())
}

module.exports = 
{
    usersInDb,
    Fyscher,
    Fyschman
}
