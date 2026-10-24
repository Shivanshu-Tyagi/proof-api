import request from 'supertest';
import mongoose from 'mongoose';
import { jest } from '@jest/globals';
import app from '../server.js';
import User from '../models/User.js';
import Relationship from '../models/Relationship.js';
import Message from '../models/Message.js';
import Notification from '../models/Notification.js';

process.env.JWT_SECRET = 'test_jwt_secret';
const TEST_DB = 'mongodb://localhost:27017/relationshipapp_test_messages';

describe('messages between people in a relationship', () => {
  let a; let b; let c; let rel; let pendingRel; let endedRel;
  const signup = async (n) => (await request(app).post('/api/auth/signup').send({
    username: `msg${n}`, email: `msg${n}@secret-mail.test`, password: 'Password123', firstName: n.toUpperCase(), lastName: 'Tester'
  })).body;
  const as = (who, req) => req.set('Authorization', `Bearer ${who.token}`);
  const send = (who, id, text) => as(who, request(app).post(`/api/messages/${id}`)).send({ text });

  beforeAll(async () => {
    await mongoose.connect(TEST_DB);
    await Promise.all([User, Relationship, Message, Notification].map((m) => m.deleteMany({})));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    a = await signup('a'); b = await signup('b'); c = await signup('c');
    rel = await Relationship.create({ initiator: a.user.id, partner: b.user.id, title: 'Duo', type: 'friend', status: 'active' });
    pendingRel = await Relationship.create({ initiator: a.user.id, partner: c.user.id, title: 'Not yet', type: 'friend', status: 'pending' });
    endedRel = await Relationship.create({ initiator: b.user.id, partner: c.user.id, title: 'Old', type: 'friend', status: 'ended' });
  });
  afterAll(async () => { await mongoose.connection.close(); jest.restoreAllMocks(); });

  it('requires sign in', async () => {
    expect((await request(app).get('/api/messages')).statusCode).toEqual(401);
  });

  it('lets both members talk, with unread counts and read receipts', async () => {
    expect((await send(a, rel.id, '  Hello there  ')).statusCode).toEqual(201);
    await send(a, rel.id, 'Second');

    const threads = await as(b, request(app).get('/api/messages'));
    const t = threads.body.threads.find((x) => x.relationshipId === rel.id);
    expect(t.unread).toEqual(2);
    expect(t.last.text).toEqual('Second');
    expect(t.other.firstName).toEqual('A');
    expect(threads.body.unreadTotal).toEqual(2);
    expect(JSON.stringify(threads.body)).not.toContain('secret-mail.test');

    const thread = await as(b, request(app).get(`/api/messages/${rel.id}`));
    expect(thread.body.messages.map((m) => [m.text, m.mine])).toEqual([['Hello there', false], ['Second', false]]);

    await as(b, request(app).post(`/api/messages/${rel.id}/read`));
    const after = await as(b, request(app).get('/api/messages'));
    expect(after.body.unreadTotal).toEqual(0);
    // The sender's own messages never count as unread for the sender
    expect((await as(a, request(app).get('/api/messages'))).body.unreadTotal).toEqual(0);
  });

  it('sends one notification for a burst of messages', async () => {
    await Notification.deleteMany({});
    await send(b, rel.id, 'one');
    await send(b, rel.id, 'two');
    await send(b, rel.id, 'three');
    expect(await Notification.countDocuments({ recipient: a.user.id })).toEqual(1);
  });

  it('keeps conversations private to the two members', async () => {
    expect((await as(c, request(app).get(`/api/messages/${rel.id}`))).statusCode).toEqual(404);
    expect((await send(c, rel.id, 'let me in')).statusCode).toEqual(404);
    expect((await as(c, request(app).post(`/api/messages/${rel.id}/read`))).statusCode).toEqual(404);
    const list = await as(c, request(app).get('/api/messages'));
    expect(list.body.threads.some((x) => x.relationshipId === rel.id)).toBe(false);
    expect(JSON.stringify(list.body)).not.toContain('Hello there');
    expect((await as(a, request(app).get('/api/messages/not-an-id'))).statusCode).toEqual(404);
  });

  it('is closed for pending relationships and read-only once ended', async () => {
    expect((await send(a, pendingRel.id, 'hi')).statusCode).toEqual(404);
    await Message.create({ relationship: endedRel._id, sender: b.user.id, text: 'bye' });
    const read = await as(c, request(app).get(`/api/messages/${endedRel.id}`));
    expect(read.statusCode).toEqual(200);
    expect(read.body.relationship.canSend).toBe(false);
    expect((await send(c, endedRel.id, 'wait')).statusCode).toEqual(403);
  });

  it('validates messages', async () => {
    expect((await send(a, rel.id, '   ')).statusCode).toEqual(400);
    expect((await send(a, rel.id, 'x'.repeat(1001))).statusCode).toEqual(400);
    expect((await as(a, request(app).post(`/api/messages/${rel.id}`)).send({ text: 5 })).statusCode).toEqual(400);
  });

  it('pages older messages', async () => {
    await Message.deleteMany({ relationship: rel._id });
    await Message.insertMany(Array.from({ length: 60 }, (_, i) => ({ relationship: rel._id, sender: a.user.id, text: `m${i}`, createdAt: new Date(Date.now() - (60 - i) * 1000) })));
    const first = await as(a, request(app).get(`/api/messages/${rel.id}`));
    expect(first.body.messages).toHaveLength(50);
    expect(first.body.hasMore).toBe(true);
    const older = await as(a, request(app).get(`/api/messages/${rel.id}?before=${encodeURIComponent(first.body.messages[0].createdAt)}`));
    expect(older.body.messages).toHaveLength(10);
    expect(older.body.hasMore).toBe(false);
  });

  it('exports your own messages and erases them when you delete your account', async () => {
    const mine = JSON.parse((await as(a, request(app).get('/api/auth/export'))).text);
    expect(mine.sentMessages.length).toEqual(60);
    expect((await as(a, request(app).post('/api/auth/delete-account')).send({ password: 'Password123' })).statusCode).toEqual(200);
    expect(await Message.countDocuments({ sender: a.user.id })).toEqual(0);
  });
});
