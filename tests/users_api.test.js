const { test, after, beforeEach, describe } = require('node:test')
const assert = require('node:assert')
const mongoose = require('mongoose')
const supertest = require('supertest')
const app = require('../app')
const helper = require('./test_helper')
const User = require('../models/user')
const api = supertest(app)

describe('when there is initially one user in db', () =>
{
    beforeEach( async () =>
    {
        await User.deleteMany({})

        await api
            .post('/api/users')
            .set('Content-Type', 'application/json')
            .send(helper.Fyscher)
            .expect(201)

        const loggedInFyscher = await api
            .post('/api/login')
            .set('Content-Type', 'application/json')
            .send({
                "username": helper.Fyscher.username,
                "password": helper.Fyscher.password
            })
            .expect(200)
    
        console.log('All Set!')
    })

    test('creation succeeds with a fresh username', async () =>
    {
        const usersAtStart = await helper.usersInDb()

        const sentUser = await api
            .post('/api/users')
            .set('Content-Type', 'application/json')
            .send(helper.Fyschman)
            .expect('Content-Type', /application\/json/)
            .expect(201)

        const returnedUser = await User.findById(sentUser._body.id)
        const savedUser = returnedUser.toJSON()
        
        const newTotalUsers = [...usersAtStart, savedUser]

        const usersAtEnd = await helper.usersInDb()
        
        assert.deepStrictEqual(usersAtEnd, newTotalUsers)
    })

    test('creation fails with proper statuscode and message if username already taken', async () =>
    {
        const usersAtStart = await helper.usersInDb()

        const result = await api
            .post('/api/users')
            .set('Content-Type', 'application/json')
            .send(helper.Fyscher)
            .expect(400)

        const usersAtEnd = await helper.usersInDb()

        assert(result.body.error.includes('E11000 duplicate key error collection'))

        assert.deepStrictEqual(usersAtStart, usersAtEnd)
    })

    test('creation fails if username received is below the minimum character length', async () =>
    {
        const usersAtStart = await helper.usersInDb()

        const newUser = 
        {
            username: 'R',
            name: 'oot',
            password: 'foooookenell'
        }

        const result = await api
            .post('/api/users')
            .send(newUser)
            .expect(400)
            .expect('Content-Type', /application\/json/)
        
        const usersAtEnd = await helper.usersInDb()

        assert(result.body.error.includes('User validation failed: username: Path `username`'))
        assert.deepStrictEqual(usersAtEnd, usersAtStart)
    })
    
    test('creation fails if password received is below the minimum character length', async () =>
    {
        const usersAtStart = await helper.usersInDb()

        const newUser = 
        {
            username: 'Root',
            name: 'oot',
            password: 'f'
        }

        const result = await api
            .post('/api/users')
            .send(newUser)
            .expect(400)
            .expect('Content-Type', /application\/json/)
        
        const usersAtEnd = await helper.usersInDb()

        assert(result.body.error.includes('Password too short'))
        assert.deepStrictEqual(usersAtEnd, usersAtStart)
    })
})

after(async () => await mongoose.connection.close())
