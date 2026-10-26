import request from 'supertest';
import mongoose from 'mongoose';
import { jest } from '@jest/globals';
import app from '../server.js';
import User from '../models/User.js';
import Relationship from '../models/Relationship.js';
import Notification from '../models/Notification.js';

process.env.JWT_SECRET = 'test_jwt_secret';
const TEST_DB = 'mongodb://localhost:27017/relationshipapp_test_inbox';

describe('Inbox requests', () => {
  let a; let b; let c;
  const signup = async (n) => (await request(app).post('/api/auth/signup').send({
    username: `inbox${n}`, email: `inbox${n}@example.com`, password: 'Password123', firstName: n.toUpperCase(), lastName: 'Tester'
  })).body;
  const as = (who, req) => req.set('Authorization', `Bearer ${who.token}`);
  const inbox = async (who) => (await as(who, request(app).get('/api/notifications'))).body.notifications;
  const find = async (who, type) => (await inbox(who)).filter((n) => n.type === type);
  const invite = async (from, to, title) => (await as(from, request(app).post('/api/relationships')).send({ partnerId: to.user.id, title, type: 'friend' })).body.relationship._id;

  beforeAll(async () => {
    await mongoose.connect(TEST_DB);
    await Promise.all([User, Relationship, Notification].map((m) => m.deleteMany({})));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    a = await signup('a'); b = await signup('b'); c = await signup('c');
  });
  afterAll(async () => { await mongoose.connection.dropDatabase(); await mongoose.connection.close(); jest.restoreAllMocks(); });

  it('an invitation asks for an answer, and stops asking once it is answered anywhere', async () => {
    const id = await invite(a, b, 'Hikers');
    const [asked] = await find(b, 'relationship_invite');
    expect(asked.actionRequired).toBe(true);
    expect(asked.actions.map((x) => x.type)).toEqual(['accept', 'decline']);

    expect((await as(b, request(app).post(`/api/relationships/${id}/accept`))).statusCode).toEqual(200);
    const [answered] = await find(b, 'relationship_invite');
    expect(answered.actionRequired).toBe(false);
    expect(answered.status).toEqual('read');
    expect((await find(a, 'relationship_accepted'))).toHaveLength(1);
  });

  it('declining an invitation also clears it', async () => {
    const id = await invite(a, c, 'Declined');
    expect((await as(c, request(app).post(`/api/relationships/${id}/decline`))).statusCode).toEqual(200);
    const [answered] = await find(c, 'relationship_invite');
    expect(answered.actionRequired).toBe(false);
    expect((await find(a, 'relationship_declined'))).toHaveLength(1);
  });

  describe('changing what you are to each other', () => {
    let id;
    beforeAll(async () => { id = (await Relationship.findOne({ title: 'Hikers' })).id; });

    it('the other person is told about the request (this used to fail silently)', async () => {
      expect((await as(a, request(app).post(`/api/relationships/${id}/request-type-change`)).send({ newType: 'close_friend', message: 'we are close now' })).statusCode).toEqual(200);
      const [asked] = await find(b, 'relationship_type_change_request');
      expect(asked).toBeTruthy();
      expect(asked.actionRequired).toBe(true);
      expect(asked.message).toMatch(/close now/);
    });

    it('declining clears the request and tells the person who asked', async () => {
      expect((await as(b, request(app).post(`/api/relationships/${id}/decline-type-change`))).statusCode).toEqual(200);
      const [answered] = await find(b, 'relationship_type_change_request');
      expect(answered.actionRequired).toBe(false);
      expect(await find(a, 'relationship_type_change_declined')).toHaveLength(1);
    });

    it('accepting clears it and tells the person who asked', async () => {
      await as(a, request(app).post(`/api/relationships/${id}/request-type-change`)).send({ newType: 'best_friend' });
      expect((await as(b, request(app).post(`/api/relationships/${id}/accept-type-change`))).statusCode).toEqual(200);
      const requests = await find(b, 'relationship_type_change_request');
      expect(requests.every((n) => n.actionRequired === false)).toBe(true);
      expect(await find(a, 'relationship_type_change_accepted')).toHaveLength(1);
    });

    it('withdrawing a request removes it from the other person\'s Inbox', async () => {
      await as(a, request(app).post(`/api/relationships/${id}/request-type-change`)).send({ newType: 'family' });
      expect((await find(b, 'relationship_type_change_request')).some((n) => n.actionRequired)).toBe(true);
      expect((await as(a, request(app).post(`/api/relationships/${id}/cancel-type-change`))).statusCode).toEqual(200);
      expect((await find(b, 'relationship_type_change_request')).some((n) => n.actionRequired)).toBe(false);
    });
  });

  describe('requests that went out of date', () => {
    it('closes an invitation that was answered before answers were tracked', async () => {
      const d = await signup('d');
      const id = await invite(a, d, 'Old invite');
      const [asked] = await find(d, 'relationship_invite');
      expect(asked.actionRequired).toBe(true);
      // The state of an older record: the relationship was answered, but the notification still asks
      await Relationship.updateOne({ _id: id }, { status: 'active' });
      const after = await find(d, 'relationship_invite');
      expect(after[0].actionRequired).toBe(false);
      expect(after[0].status).toEqual('read');
      // and so the unread badge no longer counts it
      expect((await as(d, request(app).get('/api/notifications/unread-count'))).body.unreadCount).toEqual(0);
    });

    it('closes a request whose relationship has been deleted', async () => {
      const e = await signup('e');
      const id = await invite(a, e, 'Gone');
      await Relationship.deleteOne({ _id: id });
      expect((await find(e, 'relationship_invite'))[0].actionRequired).toBe(false);
    });

    it('closes an invitation the inviter is no longer waiting on, but keeps one that is still open', async () => {
      const f = await signup('f');
      const open = await invite(a, f, 'Still open');
      const closed = await invite(c, f, 'Closed');
      await Relationship.updateOne({ _id: closed }, { status: 'declined' });
      const byTitle = Object.fromEntries((await inbox(f)).filter((n) => n.type === 'relationship_invite').map((n) => [n.metadata.relationshipId.title, n.actionRequired]));
      expect(byTitle).toEqual({ 'Still open': true, Closed: false });
      expect(open).toBeTruthy();
    });

    it('closes a type-change and a break-up request that are no longer pending', async () => {
      const id = (await Relationship.findOne({ title: 'Hikers' })).id;
      await as(a, request(app).post(`/api/relationships/${id}/request-type-change`)).send({ newType: 'family' });
      await as(a, request(app).post(`/api/relationships/${id}/request-breakup`));
      expect((await find(b, 'relationship_type_change_request')).some((n) => n.actionRequired)).toBe(true);
      expect((await find(b, 'breakup_request')).some((n) => n.actionRequired)).toBe(true);
      // both are withdrawn directly in the database, as an older version of the app might have left them
      await Relationship.updateOne({ _id: id }, { typeChangeRequest: { requested: false }, status: 'active', $unset: { breakupRequestedBy: 1 } });
      expect((await find(b, 'relationship_type_change_request')).some((n) => n.actionRequired)).toBe(false);
      expect((await find(b, 'breakup_request')).some((n) => n.actionRequired)).toBe(false);
    });
  });

  it('withdrawing a break-up request removes the question from the other person\'s Inbox', async () => {
    const id = (await Relationship.findOne({ title: 'Hikers' })).id;
    await as(a, request(app).post(`/api/relationships/${id}/request-breakup`));
    expect((await find(b, 'breakup_request')).some((n) => n.actionRequired)).toBe(true);
    await as(a, request(app).post(`/api/relationships/${id}/cancel-breakup-request`));
    expect((await find(b, 'breakup_request')).some((n) => n.actionRequired)).toBe(false);
  });
});
