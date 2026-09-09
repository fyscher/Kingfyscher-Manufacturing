const User = require('./models/user')
const jwt = require('jsonwebtoken')
const config = require('./utils/config')
const rateLimit = require('express-rate-limit')

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'Too many attempts, please try again later' },
})

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
  const decodedToken = jwt.verify(req.token, config.SECRET)
  const user = await User.findById(decodedToken.id)
  if (!user) {
    return res.status(401).json({ error: 'user not found' })
  }
  req.user = user
  next()
}

const errorHandler = (error, req, res, next) =>
{
  if (error.code === '23505' || error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return res.status(400).json({ error: `duplicate value: ${error.message}` })
  }
  if (error.code === '23514' || error.code === 'SQLITE_CONSTRAINT_CHECK') {
    return res.status(400).json({ error: error.message })
  }

  switch (error.name)
  {
    case 'JsonWebTokenError':
      return res.status(401).json({ error: 'invalid token' })
    case 'TokenExpiredError':
      return res.status(401).json({ error: 'token expired' })
  }
  next(error)
}

module.exports = { tokenExtractor, userExtractor, errorHandler, authRateLimiter }