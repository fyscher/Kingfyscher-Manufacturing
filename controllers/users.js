const usersRouter = require('express').Router()
const bcrypt = require('bcrypt')
const User = require('../models/user')
const { usersInDb } = require('../middleware')

usersRouter.post('/', async (request, response) =>
{
    const { username, name, password } = request.body

    if (password.length < 3)
    {
        response.status(400).json({ error: 'Password too short' })
    }
    
    if (password.length > 3)
    {
        const users = await usersInDb()

        if (!users.includes(username))
        {
            const saltRounds = 10
            const passwordHash = await bcrypt.hash(password, saltRounds)
            
            const user = new User({
                username,
                name,
                passwordHash,
            })
            const savedUser = await user.save()

            console.log(`${username} saved!`)
            
            response.status(201).json(savedUser)
        }
    }

})

usersRouter.get('/', async (request, response) =>
{
    const users = await User.find({})
    response.json(users)
})

usersRouter.delete('/:id', async (request, response) =>
{
    await User.findByIdAndDelete(request.params.id)
    response.status(204).end()
})


module.exports = usersRouter
