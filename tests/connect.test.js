import request from 'supertest';
import mongoose from 'mongoose';
import { jest } from '@jest/globals';
import app from '../server.js';
import User from '../models/User.js';

process.env.JWT_SECRET = 'test_jwt_secret';
const TEST_DB = 'mongodb://localhost:27017/relationshipapp_test_connect';

describe('invite link lookup', () => {
  let sam;
  beforeAll(async () => {
    await mongoose.connect(TEST_DB);
    await User.deleteMany({});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    sam = (await request(app).post('/api/auth/signup').send({ username: 'samconnect', email: 'sam@secret-mail.test', password: 'Password123', firstName: 'Sam', lastName: 'Private' })).body;
  });
  afterAll(async () => { await mongoose.connection.dropDatabase(); await mongoose.connection.close(); jest.restoreAllMocks(); });

  it('tells a signed-out visitor who sent the link, and nothing else', async () => {
    const res = await request(app).get(`/api/auth/connect/${sam.user.registrationId}`);
    expect(res.statusCode).toEqual(200);
    expect(res.body).toEqual({ firstName: 'Sam' });
    expect(JSON.stringify(res.body)).not.toMatch(/Private|secret-mail|samconnect/);
  });

  it('answers the same way for malformed and unknown links', async () => {
    const bad = await request(app).get('/api/auth/connect/short');
    const odd = await request(app).get('/api/auth/connect/' + encodeURIComponent('abc$%^&*()xyz'));
    const unknown = await request(app).get('/api/auth/connect/ZZZZZZZZZZ');
    for (const r of [bad, odd, unknown]) { expect(r.statusCode).toEqual(404); expect(r.body.message).toEqual('This invite link is not valid'); }
  });

  it('stops working once the account is deleted', async () => {
    const del = await request(app).post('/api/auth/delete-account').set('Authorization', `Bearer ${sam.token}`).send({ password: 'Password123' });
    expect(del.statusCode).toEqual(200);
    expect((await request(app).get(`/api/auth/connect/${sam.user.registrationId}`)).statusCode).toEqual(404);
  });
});
