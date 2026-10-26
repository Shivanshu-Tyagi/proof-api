import request from 'supertest';
import mongoose from 'mongoose';
import { jest } from '@jest/globals';
import app from '../server.js';
import User from '../models/User.js';
import Relationship from '../models/Relationship.js';
import Term from '../models/Term.js';
import Certificate from '../models/Certificate.js';
import Activity from '../models/Activity.js';
import Notification from '../models/Notification.js';
import PrivateNote from '../models/PrivateNote.js';
import RelationshipHistory from '../models/RelationshipHistory.js';

process.env.JWT_SECRET = 'test_jwt_secret';
// Own database so other suites cannot wipe this one's data
const TEST_DB = 'mongodb://localhost:27017/relationshipapp_test_account';

describe('account export and deletion', () => {
  let a; let b; let c; // a deletes their account, b shares a relationship with them, c is unrelated
  let relationship;
  let certificate;
  let moment;

  const signup = async (name) => (await request(app).post('/api/auth/signup').send({
    username: `acct${name}`, email: `acct${name}@secret-mail.test`, password: 'Password123', firstName: name.toUpperCase(), lastName: 'Tester'
  })).body;
  const as = (who, req) => req.set('Authorization', `Bearer ${who.token}`);

  beforeAll(async () => {
    await mongoose.connect(TEST_DB);
    await Promise.all([User, Relationship, Term, Activity, Certificate, Notification, PrivateNote, RelationshipHistory].map((m) => m.deleteMany({})));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    a = await signup('a'); b = await signup('b'); c = await signup('c');

    relationship = await Relationship.create({ initiator: a.user.id, partner: b.user.id, title: 'Shared record', type: 'friend', status: 'active' });
    await Term.create({ relationship: relationship._id, title: 'Shared agreement', description: 'd', category: 'communication', createdBy: a.user.id });
    moment = await Activity.create({
      relationship: relationship._id, createdBy: b.user.id, title: 'Lake trail', type: 'memory',
      comments: [{ user: a.user.id, text: 'A said this' }, { user: b.user.id, text: 'B said this' }],
      reactions: [{ user: a.user.id, type: 'love' }, { user: b.user.id, type: 'like' }]
    });
    await PrivateNote.create({ relationship: relationship._id, user: a.user.id, text: 'A private thought' });
    await PrivateNote.create({ relationship: relationship._id, user: b.user.id, text: 'B private thought' });
    await Notification.create({ recipient: a.user.id, type: 'system_update', title: 'Hello', message: 'm', category: 'system' });
    await RelationshipHistory.create({ relationshipId: relationship._id, eventType: 'created', actor: a.user.id, targetUser: b.user.id });
    certificate = await Certificate.create({
      relatedTo: 'relationship', relatedId: relationship._id, title: 'Cert', type: 'relationship', level: 'gold',
      recipients: [{ user: a.user.id }, { user: b.user.id }], sharing: { isPublic: true }
    });
  });

  afterAll(async () => {
    await mongoose.connection.close();
    jest.restoreAllMocks();
  });

  it('exports your own data as a download, without secrets or other people\'s private data', async () => {
    const res = await as(a, request(app).get('/api/auth/export'));
    expect(res.statusCode).toEqual(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="twogether-data-\d{4}-\d{2}-\d{2}\.json"$/);

    const text = res.text;
    const data = JSON.parse(text);
    expect(data.profile.email).toEqual('accta@secret-mail.test');
    expect(data.relationships).toHaveLength(1);
    expect(data.agreements).toHaveLength(1);
    expect(data.privateNotes.map((n) => n.text)).toEqual(['A private thought']);
    expect(data.certificates).toHaveLength(1);

    expect(text).not.toContain('B private thought');
    expect(text).not.toContain('acctb@secret-mail.test');
    expect(data.profile.password).toBeUndefined();
    expect(text).not.toContain('"password"');
  });

  it('requires sign-in to export', async () => {
    expect((await request(app).get('/api/auth/export')).statusCode).toEqual(401);
  });

  it('needs the right password to delete', async () => {
    expect((await as(a, request(app).post('/api/auth/delete-account').send({}))).statusCode).toEqual(400);
    expect((await as(a, request(app).post('/api/auth/delete-account').send({ password: 'wrong-password' }))).statusCode).toEqual(401);
    expect((await User.findById(a.user.id)).isActive).toBe(true);
  });

  it('deletes the account: no sign-in, no personal details, shared records kept for the other person', async () => {
    const res = await as(a, request(app).post('/api/auth/delete-account').send({ password: 'Password123' }));
    expect(res.statusCode).toEqual(200);

    // Cannot sign in, and the old token stops working
    const login = await request(app).post('/api/auth/login').send({ email: 'accta@secret-mail.test', password: 'Password123' });
    expect(login.statusCode).toEqual(401);
    expect((await as(a, request(app).get('/api/auth/me'))).statusCode).toEqual(401);

    // No personal details remain
    const stored = await User.findById(a.user.id).lean();
    expect(JSON.stringify(stored)).not.toContain('secret-mail');
    expect(stored.firstName).toEqual('Deleted');
    expect(stored.isActive).toBe(false);

    // Their own data is gone; the other person's note is untouched
    expect(await PrivateNote.countDocuments({ user: a.user.id })).toBe(0);
    expect(await PrivateNote.countDocuments({ user: b.user.id })).toBe(1);
    expect(await Notification.countDocuments({ recipient: a.user.id })).toBe(0);

    // The relationship ended, the other person was told, and sees only "Deleted user"
    const ended = await Relationship.findById(relationship._id);
    expect(ended.status).toEqual('ended');
    expect(ended.endDate).toBeTruthy();
    const told = await Notification.findOne({ recipient: b.user.id, title: 'A relationship has ended' });
    expect(told).toBeTruthy();

    const bView = await as(b, request(app).get('/api/relationships'));
    const seen = bView.body.relationships.find((r) => r._id === relationship._id.toString());
    expect(seen.initiator.firstName).toEqual('Deleted');
    expect(JSON.stringify(bView.body)).not.toContain('accta@secret-mail');
    expect(await Term.countDocuments({ relationship: relationship._id })).toBe(1);

    // What they said on shared moments is removed entirely; the other person's stays
    const after = await Activity.findById(moment._id).lean();
    expect(after.comments.map((cm) => cm.text)).toEqual(['B said this']);
    expect(after.reactions.map((r) => r.type)).toEqual(['like']);
    expect(after.title).toEqual('Lake trail');

    // A public certificate link they had switched on stops working
    expect((await Certificate.findById(certificate._id)).sharing.isPublic).toBe(false);
    expect((await request(app).get(`/api/verify/${encodeURIComponent(certificate.metadata.certificateNumber)}`)).statusCode).toEqual(404);
  });

  it('frees the email address, and leaves everyone else alone', async () => {
    const again = await request(app).post('/api/auth/signup').send({
      username: 'acctanew', email: 'accta@secret-mail.test', password: 'Password123', firstName: 'Fresh', lastName: 'Start'
    });
    expect(again.statusCode).toEqual(201);
    expect((await User.findById(c.user.id)).isActive).toBe(true);
    expect((await as(c, request(app).get('/api/auth/me'))).statusCode).toEqual(200);
  });
});
