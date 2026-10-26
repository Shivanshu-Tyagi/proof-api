import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';
import app from '../server.js';
import User from '../models/User.js';
import { createApiLimiter } from '../middleware/rateLimits.js';

process.env.JWT_SECRET = 'test_jwt_secret';
const TEST_DB = 'mongodb://localhost:27017/relationshipapp_test_ratelimits';
const tokenFor = (userId) => jwt.sign({ userId }, process.env.JWT_SECRET);

describe('API rate limit counts people, not addresses', () => {
  const small = express();
  small.use('/api', createApiLimiter({ userMax: 3, anonymousMax: 2 }));
  small.get('/api/ping', (req, res) => res.json({ ok: true }));
  const ping = (token) => { const r = request(small).get('/api/ping'); return token ? r.set('Authorization', `Bearer ${token}`) : r; };

  it('gives each signed-in person their own allowance, even from the same address', async () => {
    const alice = tokenFor('111111111111111111111111');
    const bob = tokenFor('222222222222222222222222');
    for (let i = 0; i < 3; i += 1) expect((await ping(alice)).statusCode).toEqual(200);
    expect((await ping(alice)).statusCode).toEqual(429);
    // Bob shares Alice's address, and is not affected
    expect((await ping(bob)).statusCode).toEqual(200);
  });

  it('limits anonymous visitors per address, and treats a bad token as anonymous', async () => {
    expect((await ping()).statusCode).toEqual(200);
    expect((await ping('not-a-real-token')).statusCode).toEqual(200);
    expect((await ping()).statusCode).toEqual(429);
  });

  it('answers with a readable message', async () => {
    const res = await ping();
    expect(res.statusCode).toEqual(429);
    expect(res.body.message).toMatch(/slow down/i);
  });
});

describe('failed logins are limited per account, not for everyone at that address', () => {
  beforeAll(async () => {
    await mongoose.connect(TEST_DB);
    await User.deleteMany({});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    await request(app).post('/api/auth/signup').send({ username: 'ratey', email: 'ratey@example.com', password: 'Password123', firstName: 'Rate', lastName: 'Y' });
  });
  afterAll(async () => { await mongoose.connection.dropDatabase(); await mongoose.connection.close(); jest.restoreAllMocks(); });

  const login = (email, password) => request(app).post('/api/auth/login').send({ email, password });

  it('blocks repeated wrong passwords for one account after 20 tries', async () => {
    for (let i = 0; i < 20; i += 1) expect((await login('victim@example.com', 'wrong-password-1')).statusCode).toEqual(401);
    const blocked = await login('victim@example.com', 'wrong-password-1');
    expect(blocked.statusCode).toEqual(429);
    expect(blocked.body.message).toMatch(/failed attempts/i);
  });

  it('does not block other accounts on the same address', async () => {
    expect((await login('ratey@example.com', 'Password123')).statusCode).toEqual(200);
    expect((await login('someone-else@example.com', 'wrong-password-1')).statusCode).toEqual(401);
  });

  it('does not count successful logins', async () => {
    // More than the 20-failure limit, to show that successes are not counted. Each one checks a real password hash, so it is slow.
    for (let i = 0; i < 22; i += 1) expect((await login('ratey@example.com', 'Password123')).statusCode).toEqual(200);
  }, 60000);
});
