const { test, beforeEach, describe } = require('node:test')
const assert = require('node:assert')
const supertest = require('supertest')
const app = require('../app')
const helper = require('./test_helper')
const User = require('../models/user')
const api = supertest(app)

describe('when there is initially one user in db', () =>
{
    beforeEach( async () =>
    {
        await User.deleteMany()

        await api
            .post('/api/users')
            .set('Content-Type', 'application/json')
            .send(helper.Fyscher)
            .expect(201)

        await api
            .post('/api/login')
            .set('Content-Type', 'application/json')
            .send({
                "username": helper.Fyscher.username,
                "password": helper.Fyscher.password
            })
            .expect(200)
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

        const usersAtEnd = await helper.usersInDb()

        assert.strictEqual(usersAtEnd.length, usersAtStart.length + 1)
        assert(usersAtEnd.some(u => u.username === helper.Fyschman.username))
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

        assert(result.body.error.includes('duplicate'))

        assert.strictEqual(usersAtEnd.length, usersAtStart.length)
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

        assert.strictEqual(usersAtEnd.length, usersAtStart.length)
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
        assert.strictEqual(usersAtEnd.length, usersAtStart.length)
    })

    test('forgot-username returns the matching username for a known name', async () =>
    {
        const result = await api
            .post('/api/users/forgot-username')
            .set('Content-Type', 'application/json')
            .send({ name: helper.Fyscher.name })
            .expect(200)
            .expect('Content-Type', /application\/json/)

        assert.deepStrictEqual(result.body.usernames, [helper.Fyscher.username])
    })

    test('forgot-username is case-insensitive', async () =>
    {
        const result = await api
            .post('/api/users/forgot-username')
            .set('Content-Type', 'application/json')
            .send({ name: helper.Fyscher.name.toUpperCase() })
            .expect(200)

        assert.deepStrictEqual(result.body.usernames, [helper.Fyscher.username])
    })

    test('forgot-username returns an empty list for an unknown name', async () =>
    {
        const result = await api
            .post('/api/users/forgot-username')
            .set('Content-Type', 'application/json')
            .send({ name: 'Nobody Here' })
            .expect(200)

        assert.deepStrictEqual(result.body.usernames, [])
    })

    test('forgot-username fails without a name', async () =>
    {
        const result = await api
            .post('/api/users/forgot-username')
            .set('Content-Type', 'application/json')
            .send({})
            .expect(400)

        assert(result.body.error.includes('Name is required'))
    })

    test('forgot-password issues a reset token for a registered email and always returns a generic message', async () =>
    {
        await api
            .post('/api/users')
            .set('Content-Type', 'application/json')
            .send({ username: 'emailuser', name: 'Email User', email: 'emailuser@example.com', password: 'testerrr' })
            .expect(201)

        const result = await api
            .post('/api/users/forgot-password')
            .set('Content-Type', 'application/json')
            .send({ email: 'emailuser@example.com' })
            .expect(200)

        assert(result.body.message.includes('If that email is registered'))

        const updatedUser = await User.findOne({ email: 'emailuser@example.com' })
        assert(updatedUser.resetToken)
        assert(updatedUser.resetTokenExpires)
    })

    test('forgot-password returns the same generic message for an unregistered email', async () =>
    {
        const result = await api
            .post('/api/users/forgot-password')
            .set('Content-Type', 'application/json')
            .send({ email: 'nobody@example.com' })
            .expect(200)

        assert(result.body.message.includes('If that email is registered'))
    })

    test('reset-password fails with an invalid token', async () =>
    {
        const result = await api
            .post('/api/users/reset-password')
            .set('Content-Type', 'application/json')
            .send({ token: 'not-a-real-token', password: 'newpassword' })
            .expect(400)

        assert(result.body.error.includes('Invalid or expired'))
    })

    test('reset-password succeeds with a valid token and updates the password', async () =>
    {
        await api
            .post('/api/users')
            .set('Content-Type', 'application/json')
            .send({ username: 'resetuser', name: 'Reset User', email: 'resetuser@example.com', password: 'oldpassword' })
            .expect(201)

        await api
            .post('/api/users/forgot-password')
            .set('Content-Type', 'application/json')
            .send({ email: 'resetuser@example.com' })
            .expect(200)

        const { resetToken } = await User.findOne({ email: 'resetuser@example.com' })

        await api
            .post('/api/users/reset-password')
            .set('Content-Type', 'application/json')
            .send({ token: resetToken, password: 'newpassword' })
            .expect(200)

        await api
            .post('/api/login')
            .set('Content-Type', 'application/json')
            .send({ username: 'resetuser', password: 'newpassword' })
            .expect(200)
    })
})
