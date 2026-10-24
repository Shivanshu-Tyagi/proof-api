import request from 'supertest';
import mongoose from 'mongoose';
import { jest } from '@jest/globals';
import app from '../server.js';
import User from '../models/User.js';
import Relationship from '../models/Relationship.js';
import Term from '../models/Term.js';

process.env.JWT_SECRET = 'test_jwt_secret';
const TEST_DB = 'mongodb://localhost:27017/relationshipapp_test_terms';

describe('agreements', () => {
  let a; let b; let c; let rel; let termId;
  const signup = async (n) => (await request(app).post('/api/auth/signup').send({
    username: `term${n}`, email: `term${n}@example.com`, password: 'Password123', firstName: n.toUpperCase(), lastName: 'Tester'
  })).body;
  const as = (who, req) => req.set('Authorization', `Bearer ${who.token}`);

  beforeAll(async () => {
    await mongoose.connect(TEST_DB);
    await Promise.all([User, Relationship, Term].map((m) => m.deleteMany({})));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    a = await signup('a'); b = await signup('b'); c = await signup('c');
    rel = await Relationship.create({ initiator: a.user.id, partner: b.user.id, title: 'Pair', type: 'friend', status: 'active' });
    const t = await as(a, request(app).post('/api/terms')).send({ relationshipId: rel.id, title: 'Leave by 8am', description: 'Start early', category: 'communication' });
    termId = t.body.term._id;
  });
  afterAll(async () => { await mongoose.connection.dropDatabase(); await mongoose.connection.close(); jest.restoreAllMocks(); });

  // The website's Agree button sends no body at all, and that must work
  it('both people can agree with a plain request that has no body', async () => {
    const first = await as(b, request(app).post(`/api/terms/${termId}/agree`));
    expect(first.statusCode).toEqual(200);
    expect(first.body.term.status).toEqual('proposed');
    const second = await as(a, request(app).post(`/api/terms/${termId}/agree`));
    expect(second.statusCode).toEqual(200);
    expect(second.body.term.agreedBy).toHaveLength(2);
    expect(second.body.term.status).toEqual('agreed');
  });

  it('agreeing twice is refused, and outsiders cannot agree', async () => {
    expect((await as(a, request(app).post(`/api/terms/${termId}/agree`))).statusCode).toEqual(400);
    expect((await as(c, request(app).post(`/api/terms/${termId}/agree`))).statusCode).toEqual(403);
  });

  it('other actions that send no body also work', async () => {
    const created = await as(a, request(app).post('/api/relationships')).send({ partnerId: c.user.id, title: 'No body pair', type: 'friend' });
    const id = created.body.relationship._id;
    expect((await as(c, request(app).post(`/api/relationships/${id}/accept`))).statusCode).toEqual(200);
    expect((await as(a, request(app).post(`/api/relationships/${id}/request-breakup`))).statusCode).toEqual(200);
    expect((await as(a, request(app).post(`/api/relationships/${id}/cancel-breakup-request`))).statusCode).toEqual(200);
  });
});
