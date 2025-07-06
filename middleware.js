const User = require('./models/user')
const jwt = require('jsonwebtoken')

const tokenExtractor = async (req, res, next) =>
{
  const authorization = await req.get('authorization')
  req.token = authorization && authorization.startsWith('Bearer ')
  ? authorization.replace('Bearer ', '')
  : null
  next()
}

const userExtractor = async (req, res, next) =>
{
  const decodedToken = jwt.verify(req.token, process.env.SECRET)
  console.log('decodedToken: ', decodedToken)
  const user = await User.findById(decodedToken.id)
  req.user = user.toJSON()
  next()
}

const usersInDb = async () =>
{
    const users = await User.find({})
    return users.map(u => u.toJSON())
}

const errorHandler = (error, req, res, next) =>
{
  switch (error.name)
  {
    case 'CastError':
      return res.status(400).json({ error: 'Malformatted Id' })
    case 'ValidationError':
      return res.status(400).json({ error: error.message })
    case 'MongoServerError':
      return error.errmsg.includes('E11000 duplicate key error collection')
      ? res.status(400).json({ error: error.message })
      : res.status(400).json({ error: 'Mongojs Server Error' })
    case 'JsonWebTokenError':
      return res.status(401).json({ error: 'invalid token' })
    case 'TokenExpiredError':
      return res.status(401).json({ error: 'token expired' })
  }
  next(error)
}

module.exports = { tokenExtractor, userExtractor, errorHandler, usersInDb }