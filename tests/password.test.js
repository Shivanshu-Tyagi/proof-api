import crypto from 'crypto';
import { jest } from '@jest/globals';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../server.js';
import User from '../models/User.js';

process.env.JWT_SECRET = 'test_jwt_secret';
// Separate database: the relationship suite wipes its own one concurrently
const TEST_DB = 'mongodb://localhost:27017/relationshipapp_test_auth';

const signup = (overrides = {}) =>
  request(app).post('/api/auth/signup').send({
    username: 'pwuser',
    email: 'pwuser@example.com',
    password: 'OldPassword1',
    firstName: 'Pw',
    lastName: 'User',
    ...overrides
  });

describe('password management', () => {
  beforeAll(async () => {
    await mongoose.connect(TEST_DB);
    await User.deleteMany({});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterAll(async () => {
    await mongoose.connection.close();
    jest.restoreAllMocks();
  });

  it('accepts real-world addresses, including long domain endings and plus-tags', async () => {
    for (const email of ['person@company.info', 'first.last+tag@sub.example.photography', 'a_b@my-site.co.uk']) {
      const res = await request(app).post('/api/auth/signup').send({
        username: `u${Math.random().toString(36).slice(2, 10)}`, email, password: 'Password123', firstName: 'Real', lastName: 'World'
      });
      expect({ email, status: res.statusCode }).toEqual({ email, status: 201 });
    }
  });

  it('still rejects things that are not email addresses', async () => {
    const res = await request(app).post('/api/auth/signup').send({ username: 'nope1', email: 'not-an-email', password: 'Password123', firstName: 'A', lastName: 'B' });
    expect(res.statusCode).toEqual(400);
  });

  it('rejects passwords shorter than 8 characters at signup', async () => {
    const res = await signup({ password: 'short' });
    expect(res.statusCode).toEqual(400);
  });

  it('strips Mongo operators from request bodies', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: { $ne: 'x' }, password: { $ne: 'x' } });
    expect(res.statusCode).toEqual(400);
  });

  it('changes the password and invalidates the old token', async () => {
    const created = await signup();
    expect(created.statusCode).toEqual(201);
    const oldToken = created.body.token;

    // Tokens carry second-resolution timestamps
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const wrong = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${oldToken}`)
      .send({ currentPassword: 'nope-nope', newPassword: 'NewPassword1' });
    expect(wrong.statusCode).toEqual(401);

    const changed = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${oldToken}`)
      .send({ currentPassword: 'OldPassword1', newPassword: 'NewPassword1' });
    expect(changed.statusCode).toEqual(200);

    const stale = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${oldToken}`);
    expect(stale.statusCode).toEqual(401);

    const fresh = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${changed.body.token}`);
    expect(fresh.statusCode).toEqual(200);

    const login = await request(app).post('/api/auth/login').send({ email: 'pwuser@example.com', password: 'NewPassword1' });
    expect(login.statusCode).toEqual(200);
  });

  it('answers forgot-password the same for unknown emails', async () => {
    const known = await request(app).post('/api/auth/forgot-password').send({ email: 'pwuser@example.com' });
    const unknown = await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@example.com' });
    expect(known.statusCode).toEqual(200);
    expect(unknown.statusCode).toEqual(200);
    expect(known.body).toEqual(unknown.body);
  });

  it('resets the password with a valid token only once', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    await User.updateOne(
      { email: 'pwuser@example.com' },
      { passwordResetToken: crypto.createHash('sha256').update(token).digest('hex'), passwordResetExpires: new Date(Date.now() + 60000) }
    );

    const bad = await request(app).post(`/api/auth/reset-password/${'a'.repeat(64)}`).send({ password: 'BrandNew123' });
    expect(bad.statusCode).toEqual(400);

    const ok = await request(app).post(`/api/auth/reset-password/${token}`).send({ password: 'BrandNew123' });
    expect(ok.statusCode).toEqual(200);

    const again = await request(app).post(`/api/auth/reset-password/${token}`).send({ password: 'AnotherOne123' });
    expect(again.statusCode).toEqual(400);

    const login = await request(app).post('/api/auth/login').send({ email: 'pwuser@example.com', password: 'BrandNew123' });
    expect(login.statusCode).toEqual(200);
  });

  it('rejects expired reset tokens', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    await User.updateOne(
      { email: 'pwuser@example.com' },
      { passwordResetToken: crypto.createHash('sha256').update(token).digest('hex'), passwordResetExpires: new Date(Date.now() - 1000) }
    );
    const res = await request(app).post(`/api/auth/reset-password/${token}`).send({ password: 'Whatever123' });
    expect(res.statusCode).toEqual(400);
  });
});

describe('user search privacy', () => {
  let searcher;
  let target;

  beforeAll(async () => {
    await mongoose.connect(TEST_DB);
    await User.deleteMany({});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const make = async (username, extra = {}) => (await request(app).post('/api/auth/signup').send({
      username, email: `${username}@private-mail.test`, password: 'Password123', firstName: 'Quincy', lastName: username, ...extra
    })).body;
    searcher = await make('searcher');
    target = await make('findable');
  });

  afterAll(async () => {
    await mongoose.connection.close();
    jest.restoreAllMocks();
  });

  const auth = (req) => req.set('Authorization', `Bearer ${searcher.token}`);

  it('finds people by name but never returns or matches email addresses', async () => {
    const byName = await auth(request(app).get('/api/auth/search').query({ q: 'findable' }));
    expect(byName.body.users).toHaveLength(1);
    expect(JSON.stringify(byName.body)).not.toContain('private-mail');
    expect(byName.body.users[0].email).toBeUndefined();

    const byEmailFragment = await auth(request(app).get('/api/auth/search').query({ q: 'private-mail' }));
    expect(byEmailFragment.body.users).toHaveLength(0);
  });

  it('looks up a registration ID without revealing the email', async () => {
    const res = await auth(request(app).get('/api/auth/search').query({ registrationId: target.user.registrationId }));
    expect(res.statusCode).toEqual(200);
    expect(res.body.user.username).toEqual('findable');
    expect(res.body.user.email).toBeUndefined();
  });

  it('confirms a full email address exactly, and nothing less', async () => {
    const exact = await auth(request(app).get('/api/auth/search/email').query({ q: 'findable@private-mail.test' }));
    expect(exact.body.users).toHaveLength(1);
    expect(exact.body.users[0].email).toBeUndefined();

    const partial = await auth(request(app).get('/api/auth/search/email').query({ q: 'findable@private' }));
    expect(partial.body.users).toHaveLength(0);
    const fragment = await auth(request(app).get('/api/auth/search/email').query({ q: 'findab' }));
    expect(fragment.body.users).toHaveLength(0);
  });

  it('lets an invitation name the person by ID instead of email', async () => {
    const res = await request(app).post('/api/relationships').set('Authorization', `Bearer ${searcher.token}`)
      .send({ partnerId: target.user.id, title: 'By ID', type: 'friend' });
    expect(res.statusCode).toEqual(201);
    expect(res.body.relationship.partner._id).toEqual(target.user.id);

    const none = await request(app).post('/api/relationships').set('Authorization', `Bearer ${searcher.token}`)
      .send({ title: 'Nobody', type: 'friend' });
    expect(none.statusCode).toEqual(400);
  });
});
