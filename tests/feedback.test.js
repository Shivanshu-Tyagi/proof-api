import request from 'supertest';
import mongoose from 'mongoose';
import { jest } from '@jest/globals';
import app from '../server.js';
import User from '../models/User.js';
import Feedback from '../models/Feedback.js';

process.env.JWT_SECRET = 'test_jwt_secret';
process.env.ADMIN_EMAILS = 'owner@example.com';
const TEST_DB = 'mongodb://localhost:27017/relationshipapp_test_feedback';

describe('feedback and suggestions', () => {
  let maya; let jonas; let owner;
  const signup = async (username, email, firstName) => (await request(app).post('/api/auth/signup').send({
    username, email, password: 'Password123', firstName, lastName: 'Private'
  })).body;
  const as = (who, req) => req.set('Authorization', `Bearer ${who.token}`);
  const post = (who, data) => as(who, request(app).post('/api/feedback')).send({ type: 'idea', title: 'Dark mode on the certificate', body: 'It would be nice to have more themes.', ...data });
  const list = (who, qs = '') => as(who, request(app).get(`/api/feedback${qs}`));

  beforeAll(async () => {
    await mongoose.connect(TEST_DB);
    await Promise.all([User, Feedback].map((m) => m.deleteMany({})));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    maya = await signup('fbmaya', 'maya@example.com', 'Maya');
    jonas = await signup('fbjonas', 'jonas@secret-mail.test', 'Jonas');
    owner = await signup('fbowner', 'owner@example.com', 'Owner');
  });
  afterAll(async () => { await mongoose.connection.dropDatabase(); await mongoose.connection.close(); jest.restoreAllMocks(); });

  it('needs sign-in', async () => {
    expect((await request(app).get('/api/feedback')).statusCode).toEqual(401);
    expect((await request(app).post('/api/feedback').send({})).statusCode).toEqual(401);
  });

  it('shares an idea: it starts with one "me too" (the author) and shows the first name only', async () => {
    const res = await post(maya, { title: 'Reminders for milestones', body: 'Send me a reminder the day before a milestone is due.' });
    expect(res.statusCode).toEqual(201);
    expect(res.body.feedback).toMatchObject({ type: 'idea', title: 'Reminders for milestones', status: 'open', authorName: 'Maya', mine: true, supported: true, supportCount: 1 });
    const text = JSON.stringify((await list(jonas)).body);
    expect(text).not.toMatch(/Private|secret-mail|maya@example\.com|fbmaya/);
  });

  it('refuses incomplete or invalid feedback with a plain reason', async () => {
    const cases = [
      [{ type: 'complaint' }, /kind of feedback/i],
      [{ title: 'Hi' }, /title/i],
      [{ body: 'Too short' }, /details/i],
      [{ body: 'x'.repeat(1001) }, /details/i],
      [{ title: undefined }, /title/i],
    ];
    for (const [patch, message] of cases) {
      const res = await post(maya, patch);
      expect(res.statusCode).toEqual(400);
      expect(res.body.message).toMatch(message);
    }
  });

  it('hides the name on an anonymous post, even from the page that lists everything', async () => {
    const res = await post(jonas, { type: 'problem', title: 'Invite email never arrived', body: 'I invited a friend and nothing arrived.', anonymous: true });
    expect(res.body.feedback.authorName).toEqual('Anonymous');
    const seenByMaya = (await list(maya)).body.feedback.find((f) => f.title === 'Invite email never arrived');
    expect(seenByMaya.authorName).toEqual('Anonymous');
    expect(seenByMaya.mine).toBe(false);
    expect(JSON.stringify(seenByMaya)).not.toMatch(/Jonas/);
  });

  describe('"me too"', () => {
    let id;
    beforeAll(async () => { id = (await Feedback.findOne({ title: 'Reminders for milestones' })).id; });
    const support = (who) => as(who, request(app).post(`/api/feedback/${id}/support`));

    it('adds one voice per person and can take it back', async () => {
      const on = await support(jonas);
      expect(on.body).toEqual({ supported: true, supportCount: 2 });
      const off = await support(jonas);
      expect(off.body).toEqual({ supported: false, supportCount: 1 });
      expect((await support(jonas)).body).toEqual({ supported: true, supportCount: 2 });
    });

    it('cannot be counted twice by tapping quickly', async () => {
      await Promise.all(Array.from({ length: 6 }, () => support(owner)));
      const doc = await Feedback.findById(id);
      expect(doc.supportCount).toEqual(doc.supporters.length);
      expect(doc.supporters.filter((s) => String(s) === owner.user.id).length).toBeLessThanOrEqual(1);
    });

    it('shows each person whether they already said "me too"', async () => {
      const mine = (await list(jonas)).body.feedback.find((f) => f.id === id);
      expect(mine.supported).toBe(true);
      const author = (await list(maya)).body.feedback.find((f) => f.id === id);
      expect(author.supportCount).toEqual(mine.supportCount);
    });

    it('answers 404 for something that does not exist', async () => {
      expect((await as(jonas, request(app).post('/api/feedback/000000000000000000000000/support'))).statusCode).toEqual(404);
      expect((await as(jonas, request(app).post('/api/feedback/not-an-id/support'))).statusCode).toEqual(404);
    });
  });

  describe('finding things', () => {
    beforeAll(async () => {
      await Feedback.deleteMany({ title: /^Filler/ });
      await Feedback.insertMany(Array.from({ length: 23 }, (_, i) => ({
        author: maya.user.id, type: 'other', title: `Filler item ${i}`, body: `Some filler text number ${i}`, supporters: [maya.user.id], supportCount: 1,
        createdAt: new Date(Date.now() - i * 1000)
      })));
    });

    it('ranks by "me too" first and by newest otherwise', async () => {
      const top = (await list(maya, '?sort=top')).body.feedback;
      expect(top[0].supportCount).toBeGreaterThanOrEqual(top[1].supportCount);
      expect(top[0].title).toEqual('Reminders for milestones');
      const newest = (await list(maya, '?sort=new')).body.feedback;
      const times = newest.map((f) => new Date(f.createdAt).getTime());
      expect([...times].sort((a, b) => b - a)).toEqual(times);
    });

    it('filters by kind, searches, and shows only your own', async () => {
      expect((await list(maya, '?type=problem')).body.feedback.every((f) => f.type === 'problem')).toBe(true);
      const found = (await list(maya, '?q=reminders')).body.feedback;
      expect(found.map((f) => f.title)).toEqual(['Reminders for milestones']);
      expect((await list(maya, '?mine=true')).body.feedback.every((f) => f.mine)).toBe(true);
      expect((await list(jonas, '?mine=true')).body.feedback.map((f) => f.title)).toEqual(['Invite email never arrived']);
    });

    it('finds posts by their words, in any order, and can suggest similar ones from one meaningful word', async () => {
      await post(jonas, { title: 'Calendar view for milestones', body: 'A monthly calendar would be lovely.' });
      const all = async (q) => (await list(maya, `?q=${encodeURIComponent(q)}`)).body.feedback.map((f) => f.title);
      expect(await all('milestones calendar')).toContain('Calendar view for milestones');
      expect(await all('calendar zzzunmatched')).toEqual([]); // every word has to appear
      const any = async (q) => (await list(maya, `?match=any&q=${encodeURIComponent(q)}`)).body.feedback.map((f) => f.title);
      expect(await any('I want a calendar too')).toContain('Calendar view for milestones');
      expect(await any('I want it too')).toEqual([]); // only filler words, so nothing to suggest
    });

    it('treats search text as plain words, never as a pattern', async () => {
      for (const q of ['(', '.*', '[a-z', '\\']) expect((await list(maya, `?q=${encodeURIComponent(q)}`)).statusCode).toEqual(200);
      expect((await list(maya, `?q=${encodeURIComponent('.*')}`)).body.total).toEqual(0);
    });

    it('pages the results', async () => {
      const first = (await list(maya, '?sort=new')).body;
      expect(first.feedback).toHaveLength(20);
      expect(first.hasMore).toBe(true);
      const second = (await list(maya, '?sort=new&page=2')).body;
      expect(second.feedback.length).toBeGreaterThan(0);
      expect(second.hasMore).toBe(false);
      expect(new Set([...first.feedback, ...second.feedback].map((f) => f.id)).size).toEqual(first.feedback.length + second.feedback.length);
    });

    it('rejects strange sort or filter values', async () => {
      expect((await list(maya, '?sort=random')).statusCode).toEqual(400);
      expect((await list(maya, '?type=spam')).statusCode).toEqual(400);
      expect((await list(maya, '?page=0')).statusCode).toEqual(400);
    });
  });

  describe('removing and replying', () => {
    let id;
    beforeAll(async () => { id = (await post(jonas, { title: 'Please add a calendar', body: 'A calendar view of milestones would help.' })).body.feedback.id; });

    it('only the author (or the owner) can remove it', async () => {
      expect((await as(maya, request(app).delete(`/api/feedback/${id}`))).statusCode).toEqual(403);
      expect((await as(jonas, request(app).delete(`/api/feedback/${id}`))).statusCode).toEqual(200);
      const again = (await post(maya, { title: 'Another one to remove', body: 'The owner can remove anything.' })).body.feedback.id;
      expect((await as(owner, request(app).delete(`/api/feedback/${again}`))).statusCode).toEqual(200);
    });

    it('only the owner can set a status and reply, and everyone then sees it', async () => {
      const made = (await post(jonas, { title: 'Export my messages', body: 'Let me download the conversation as a file.' })).body.feedback.id;
      const body = { status: 'planned', response: 'Good idea, this is on the list for next month.' };
      expect((await as(jonas, request(app).patch(`/api/feedback/${made}`)).send(body)).statusCode).toEqual(403);
      const done = await as(owner, request(app).patch(`/api/feedback/${made}`)).send(body);
      expect(done.statusCode).toEqual(200);
      const seen = (await list(maya)).body.feedback.find((f) => f.id === made);
      expect(seen).toMatchObject({ status: 'planned', response: body.response });
      expect((await as(owner, request(app).patch(`/api/feedback/${made}`)).send({ status: 'shipped' })).statusCode).toEqual(400);
    });

    it('tells the owner, and nobody else, that they can moderate', async () => {
      expect((await list(owner)).body.canModerate).toBe(true);
      expect((await list(maya)).body.canModerate).toBe(false);
      const someone = (await list(owner)).body.feedback[0];
      expect(someone.canDelete).toBe(true);
    });
  });

  it('leaves with the person: their feedback and their "me too" are removed, and the export includes their feedback', async () => {
    const leaver = await signup('fbleaver', 'leaver@example.com', 'Leaver');
    const mineId = (await post(leaver, { title: 'My own thought', body: 'Something I would like to see here.' })).body.feedback.id;
    const target = await Feedback.findOne({ title: 'Reminders for milestones' });
    await as(leaver, request(app).post(`/api/feedback/${target.id}/support`));
    const before = (await Feedback.findById(target.id)).supportCount;

    const exported = JSON.parse((await as(leaver, request(app).get('/api/auth/export'))).text);
    expect(exported.feedback.map((f) => f.title)).toEqual(['My own thought']);

    expect((await as(leaver, request(app).post('/api/auth/delete-account')).send({ password: 'Password123' })).statusCode).toEqual(200);
    expect(await Feedback.findById(mineId)).toBeNull();
    const after = await Feedback.findById(target.id);
    expect(after.supportCount).toEqual(before - 1);
    expect(after.supporters.map(String)).not.toContain(leaver.user.id);
  });
});
