import { jest } from '@jest/globals';
import request from 'supertest';
import app from '../server.js'; // Adjust path as necessary to import your Express app
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Relationship from '../models/Relationship.js';
import Notification from '../models/Notification.js';
import RelationshipHistory from '../models/RelationshipHistory.js';

// Mock environment variables for testing
process.env.JWT_SECRET = 'test_jwt_secret';
process.env.MONGO_URI = 'mongodb://localhost:27017/relationshipapp_test';

let token;
let testUsers;
let testRelationships;

describe('Relationship API', () => {
  beforeAll(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    // Clean up previous test data
    await User.deleteMany({});
    await Relationship.deleteMany({});
    await Notification.deleteMany({});
    await RelationshipHistory.deleteMany({});
    await Relationship.syncIndexes();

    // Create test users
    // Use create() so the registrationId pre-save hook runs (insertMany skips it)
    testUsers = await User.create([
      { username: 'user1', email: 'user1@example.com', password: 'password123', firstName: 'Test', lastName: 'User1' },
      { username: 'user2', email: 'user2@example.com', password: 'password123', firstName: 'Test', lastName: 'User2' },
      { username: 'user3', email: 'user3@example.com', password: 'password123', firstName: 'Test', lastName: 'User3' },
      { username: 'user4', email: 'user4@example.com', password: 'password123', firstName: 'Test', lastName: 'User4' }
    ]);

    // Generate a token for user1
    token = jwt.sign({ userId: testUsers[0]._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

    // Create some test relationships
    testRelationships = await Relationship.insertMany([
      { 
        initiator: testUsers[0]._id,
        partner: testUsers[1]._id,
        title: 'Friendship', 
        type: 'friend',
        status: 'active'
      },
      { 
        initiator: testUsers[0]._id,
        partner: testUsers[2]._id,
        title: 'Pending Breakup', 
        type: 'romantic_interest',
        status: 'requested_breakup',
        breakupRequestedBy: testUsers[0]._id
      },
      { // Relationship not involving user1 for access tests
        initiator: testUsers[1]._id,
        partner: testUsers[2]._id,
        title: 'Secret Bond', 
        type: 'close_friend',
        status: 'active'
      }
    ]);
  });

  afterAll(async () => {
    await mongoose.connection.close();
  });

  // Test cases for createRelationship
  describe('POST /api/relationships', () => {
    it('should create a new relationship invitation', async () => {
      const res = await request(app)
        .post('/api/relationships')
        .set('Authorization', `Bearer ${token}`)
        .send({
          partnerEmail: testUsers[3].email,
          title: 'New Friendship',
          type: 'friend'
        });
      expect(res.statusCode).toEqual(201);
      expect(res.body.message).toEqual('Relationship invitation sent successfully');
      expect(res.body.relationship.initiator._id).toEqual(testUsers[0]._id.toString());
      expect(res.body.relationship.partner._id).toEqual(testUsers[3]._id.toString());
      expect(res.body.relationship.status).toEqual('pending');
    });

    it('should return 400 if relationship already exists', async () => {
      const res = await request(app)
        .post('/api/relationships')
        .set('Authorization', `Bearer ${token}`)
        .send({
          partnerEmail: testUsers[1].email,
          title: 'Friendship',
          type: 'friend'
        });
      expect(res.statusCode).toEqual(400);
      expect(res.body.message).toEqual('Relationship already exists');
    });
  });

  // Test cases for getRelationships
  describe('GET /api/relationships', () => {
    it('should return all relationships for the authenticated user', async () => {
      const res = await request(app)
        .get('/api/relationships')
        .set('Authorization', `Bearer ${token}`);
      expect(res.statusCode).toEqual(200);
      expect(res.body.relationships.length).toEqual(3); // 2 fixtures + the invitation created above
      expect(res.body.pagination).toBeDefined();
    });
  });

  // Test cases for getRelationship
  describe('GET /api/relationships/:id', () => {
    it('should return a specific relationship if authorized', async () => {
      const res = await request(app)
        .get(`/api/relationships/${testRelationships[0]._id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.statusCode).toEqual(200);
      expect(res.body.relationship._id).toEqual(testRelationships[0]._id.toString());
    });

    it('should return 404 if relationship not found', async () => {
      const res = await request(app)
        .get('/api/relationships/60d0fe4f5311236168a737f2') // Non-existent ID
        .set('Authorization', `Bearer ${token}`);
      expect(res.statusCode).toEqual(404);
      expect(res.body.message).toEqual('Relationship not found');
    });

    it('should return 403 if not authorized', async () => {
      const res = await request(app)
        .get(`/api/relationships/${testRelationships[2]._id}`) // user1 not part of this relationship
        .set('Authorization', `Bearer ${token}`);
      expect(res.statusCode).toEqual(403);
      expect(res.body.message).toEqual('Access denied');
    });
  });

  // Test cases for requestBreakup
  describe('POST /api/relationships/:id/request-breakup', () => {
    it('should allow an active relationship to request breakup', async () => {
      const res = await request(app)
        .post(`/api/relationships/${testRelationships[0]._id}/request-breakup`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.statusCode).toEqual(200);
      expect(res.body.message).toEqual('Breakup request sent successfully');
      expect(res.body.relationship.status).toEqual('requested_breakup');
      expect(res.body.relationship.breakupRequestedBy).toEqual(testUsers[0]._id.toString());

      // Verify notification created for partner
      const notification = await Notification.findOne({
        recipient: testUsers[1]._id,
        type: 'breakup_request',
        'metadata.relationshipId': testRelationships[0]._id
      });
      expect(notification).toBeDefined();
    });

    it('should return 400 if relationship is not active', async () => {
      // Use the relationship already in 'requested_breakup' status
      const res = await request(app)
        .post(`/api/relationships/${testRelationships[1]._id}/request-breakup`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.statusCode).toEqual(400);
      expect(res.body.message).toEqual('Can only request breakup for active relationships');
    });
  });

  // Test cases for confirmBreakup
  describe('POST /api/relationships/:id/confirm-breakup', () => {
    let pendingBreakupRel;
    let user2Token;

    beforeAll(async () => {
      // Only one live relationship per pair is allowed, so clear earlier fixtures first
      await Relationship.deleteMany({ initiator: testUsers[0]._id, partner: testUsers[1]._id });
      // Create a new relationship with breakup requested by user1, to be confirmed by user2
      pendingBreakupRel = await Relationship.create({
        initiator: testUsers[0]._id,
        partner: testUsers[1]._id,
        title: 'Breakup to Confirm',
        type: 'romantic_interest',
        status: 'requested_breakup',
        breakupRequestedBy: testUsers[0]._id
      });
      user2Token = jwt.sign({ userId: testUsers[1]._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    });

    it('should allow partner to confirm breakup', async () => {
      const res = await request(app)
        .post(`/api/relationships/${pendingBreakupRel._id}/confirm-breakup`)
        .set('Authorization', `Bearer ${user2Token}`);
      expect(res.statusCode).toEqual(200);
      expect(res.body.message).toEqual('Breakup confirmed successfully');
      expect(res.body.relationship.status).toEqual('ended');

      // Verify notification created for initiator
      const notification = await Notification.findOne({
        recipient: testUsers[0]._id,
        type: 'breakup_confirmed',
        'metadata.relationshipId': pendingBreakupRel._id
      });
      expect(notification).toBeDefined();
    });

    it('should return 400 if relationship is not in requested_breakup state', async () => {
      // Attempt to confirm an already ended relationship
      const res = await request(app)
        .post(`/api/relationships/${pendingBreakupRel._id}/confirm-breakup`)
        .set('Authorization', `Bearer ${user2Token}`);
      expect(res.statusCode).toEqual(400);
      expect(res.body.message).toEqual('Relationship is not in breakup request state');
    });

    it('should return 400 if user tries to confirm their own breakup request', async () => {
      // Create another pending breakup where user1 is the requester
      const selfRequestedBreakup = await Relationship.create({
        initiator: testUsers[1]._id,
        partner: testUsers[0]._id,
        title: 'Self Confirm Test',
        type: 'friend',
        status: 'requested_breakup',
        breakupRequestedBy: testUsers[1]._id
      });

      const res = await request(app)
        .post(`/api/relationships/${selfRequestedBreakup._id}/confirm-breakup`)
        .set('Authorization', `Bearer ${user2Token}`); // user2 is initiator here, trying to confirm their own request
      expect(res.statusCode).toEqual(400);
      expect(res.body.message).toEqual('You cannot confirm your own breakup request');
    });
  });

  // Test cases for cancelBreakupRequest
  describe('POST /api/relationships/:id/cancel-breakup-request', () => {
    let cancelableBreakupRel;

    beforeEach(async () => {
      await Relationship.deleteMany({ initiator: testUsers[0]._id, partner: testUsers[1]._id });
      // Create a relationship with breakup requested by user1
      cancelableBreakupRel = await Relationship.create({
        initiator: testUsers[0]._id,
        partner: testUsers[1]._id,
        title: 'Cancelable Breakup',
        type: 'friend',
        status: 'requested_breakup',
        breakupRequestedBy: testUsers[0]._id
      });
    });

    it('should allow the initiator to cancel a breakup request', async () => {
      const res = await request(app)
        .post(`/api/relationships/${cancelableBreakupRel._id}/cancel-breakup-request`)
        .set('Authorization', `Bearer ${token}`); // user1 is the initiator
      expect(res.statusCode).toEqual(200);
      expect(res.body.message).toEqual('Breakup request canceled successfully. Relationship is now active.');
      expect(res.body.relationship.status).toEqual('active');
      expect(res.body.relationship.breakupRequestedBy).toBeUndefined();

      // Verify notification created for partner
      const notification = await Notification.findOne({
        recipient: testUsers[1]._id,
        type: 'breakup_request_canceled',
        'metadata.relationshipId': cancelableBreakupRel._id
      });
      expect(notification).toBeDefined();
    });

    it('should return 400 if no breakup request is pending', async () => {
      // Change status to active
      cancelableBreakupRel.status = 'active';
      await cancelableBreakupRel.save();

      const res = await request(app)
        .post(`/api/relationships/${cancelableBreakupRel._id}/cancel-breakup-request`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.statusCode).toEqual(400);
      expect(res.body.message).toEqual('No breakup request pending for this relationship');
    });

    it('should return 403 if non-initiator tries to cancel', async () => {
      const user2Token = jwt.sign({ userId: testUsers[1]._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
      const res = await request(app)
        .post(`/api/relationships/${cancelableBreakupRel._id}/cancel-breakup-request`)
        .set('Authorization', `Bearer ${user2Token}`); // user2 is partner, not initiator
      expect(res.statusCode).toEqual(403);
      expect(res.body.message).toEqual('Only the initiator can cancel the breakup request');
    });
  });

  describe('history access', () => {
    let secretBond; // user2 (initiator) <-> user3 (partner)
    let user2Token;
    let user3Token;

    beforeAll(() => {
      secretBond = testRelationships[2];
      user2Token = jwt.sign({ userId: testUsers[1]._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
      user3Token = jwt.sign({ userId: testUsers[2]._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    });

    const viewHistory = (viewerToken, ownerId) =>
      request(app).get(`/api/relationships/history/${ownerId}`).set('Authorization', `Bearer ${viewerToken}`);

    it('denies viewing another user\'s history without a grant', async () => {
      const res = await viewHistory(user2Token, testUsers[2]._id);
      expect(res.statusCode).toEqual(403);
    });

    it('does not let a non-member request access', async () => {
      const res = await request(app)
        .post(`/api/relationships/${secretBond._id}/request-history-access`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.statusCode).toEqual(403);
    });

    it('does not let the requester answer their own request', async () => {
      await request(app)
        .post(`/api/relationships/${secretBond._id}/request-history-access`)
        .set('Authorization', `Bearer ${user2Token}`)
        .expect(200);
      const res = await request(app)
        .post(`/api/relationships/${secretBond._id}/grant-history-access`)
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ granted: true });
      expect(res.statusCode).toEqual(403);
    });

    it('lets the requester view history only after the other person grants it', async () => {
      await request(app)
        .post(`/api/relationships/${secretBond._id}/grant-history-access`)
        .set('Authorization', `Bearer ${user3Token}`)
        .send({ granted: true })
        .expect(200);

      const allowed = await viewHistory(user2Token, testUsers[2]._id);
      expect(allowed.statusCode).toEqual(200);
      expect(Array.isArray(allowed.body.history)).toBe(true);
      expect(allowed.body.access).toEqual({ self: false, expiresAt: null });

      // Only titles and dates are shared: third parties are anonymous, free-form details are gone
      await RelationshipHistory.create({
        relationshipId: testRelationships[1]._id,
        eventType: 'created',
        actor: testUsers[0]._id,
        targetUser: testUsers[2]._id,
        details: { secret: 'private detail' }
      });
      const shaped = await viewHistory(user2Token, testUsers[2]._id);
      const created = shaped.body.history.find((e) => e.eventType === 'created');
      expect(created.actor).toEqual('Someone');
      expect(created.targetUser).toEqual('Test User3');
      expect(created.relationship.title).toEqual('Pending Breakup');
      expect(created.details).toBeUndefined();
      expect(JSON.stringify(shaped.body)).not.toContain('private detail');

      // Access is one-way and does not extend to other users
      expect((await viewHistory(user3Token, testUsers[1]._id)).statusCode).toEqual(403);
      expect((await viewHistory(token, testUsers[2]._id)).statusCode).toEqual(403);
    });

    it('revokes access when the grant is denied', async () => {
      await request(app)
        .post(`/api/relationships/${secretBond._id}/grant-history-access`)
        .set('Authorization', `Bearer ${user3Token}`)
        .send({ granted: false })
        .expect(200);
      expect((await viewHistory(user2Token, testUsers[2]._id)).statusCode).toEqual(403);
    });

    it('can grant for a limited time, and the grant stops working once it expires', async () => {
      await request(app).post(`/api/relationships/${secretBond._id}/request-history-access`).set('Authorization', `Bearer ${user2Token}`).expect(200);

      const badDuration = await request(app)
        .post(`/api/relationships/${secretBond._id}/grant-history-access`)
        .set('Authorization', `Bearer ${user3Token}`)
        .send({ granted: true, durationDays: 3 });
      expect(badDuration.statusCode).toEqual(400);

      await request(app)
        .post(`/api/relationships/${secretBond._id}/grant-history-access`)
        .set('Authorization', `Bearer ${user3Token}`)
        .send({ granted: true, durationDays: 7 })
        .expect(200);

      const stored = await Relationship.findById(secretBond._id);
      const days = (stored.historyAccess.expiresAt - Date.now()) / (24 * 60 * 60 * 1000);
      expect(days).toBeGreaterThan(6.9);
      expect(days).toBeLessThanOrEqual(7);
      expect((await viewHistory(user2Token, testUsers[2]._id)).statusCode).toEqual(200);

      await Relationship.updateOne({ _id: secretBond._id }, { 'historyAccess.expiresAt': new Date(Date.now() - 1000) });
      expect((await viewHistory(user2Token, testUsers[2]._id)).statusCode).toEqual(403);

      // An expired grant can be asked for again
      const again = await request(app).post(`/api/relationships/${secretBond._id}/request-history-access`).set('Authorization', `Bearer ${user2Token}`);
      expect(again.statusCode).toEqual(200);
    });
  });

  describe('private notes', () => {
    let rel;
    let user2Token;
    let user3Token;

    beforeAll(() => {
      rel = testRelationships[2];
      user2Token = jwt.sign({ userId: testUsers[1]._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
      user3Token = jwt.sign({ userId: testUsers[2]._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    });

    const save = (tok, text) => request(app).put(`/api/relationships/${rel._id}/note`).set('Authorization', `Bearer ${tok}`).send({ text });
    const read = (tok) => request(app).get(`/api/relationships/${rel._id}/note`).set('Authorization', `Bearer ${tok}`);

    it('keeps each person\'s note private to them', async () => {
      expect((await save(user2Token, 'mine')).statusCode).toEqual(200);
      expect((await save(user3Token, 'theirs')).statusCode).toEqual(200);
      expect((await read(user2Token)).body.note.text).toEqual('mine');
      expect((await read(user3Token)).body.note.text).toEqual('theirs');
    });

    it('is closed to people outside the relationship', async () => {
      expect((await read(token)).statusCode).toEqual(403);
      expect((await save(token, 'sneaky')).statusCode).toEqual(403);
    });

    it('removes the note when it is saved empty', async () => {
      await save(user2Token, '   ').expect(200);
      expect((await read(user2Token)).body.note).toBeNull();
      expect((await read(user3Token)).body.note.text).toEqual('theirs');
    });
  });

  describe('settings and notification preferences', () => {
    let rel;
    let ownerToken; // user3
    let partnerToken; // user4

    beforeAll(async () => {
      rel = await Relationship.create({ initiator: testUsers[2]._id, partner: testUsers[3]._id, title: 'Perms', type: 'friend', status: 'active' });
      ownerToken = jwt.sign({ userId: testUsers[2]._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
      partnerToken = jwt.sign({ userId: testUsers[3]._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    });

    const putSettings = (tok, body) => request(app).put(`/api/relationships/${rel._id}`).set('Authorization', `Bearer ${tok}`).send(body);
    const addActivity = (tok) => request(app).post('/api/activities').set('Authorization', `Bearer ${tok}`)
      .send({ relationshipId: rel._id.toString(), title: 'A moment', type: 'memory' });
    const addMilestone = (tok, title) => request(app).post('/api/milestones').set('Authorization', `Bearer ${tok}`)
      .send({ relationshipId: rel._id.toString(), title, category: 'communication', difficulty: 'easy' });

    it('stores only the "who can add" permissions and ignores everything else', async () => {
      const res = await putSettings(ownerToken, { settings: { permissions: { createActivities: false, editProfile: false, evil: true }, privacy: 'public' } });
      expect(res.statusCode).toEqual(200);
      const stored = await Relationship.findById(rel._id).lean();
      expect(stored.settings.permissions.createActivities).toBe(false);
      expect(stored.settings.permissions.editProfile).toBe(true);
      expect(stored.settings.permissions.evil).toBeUndefined();
      expect(stored.settings.privacy).toEqual('private');
    });

    it('blocks adding moments for both people while that permission is off, then allows it again', async () => {
      for (const tok of [ownerToken, partnerToken]) {
        const blocked = await addActivity(tok);
        expect(blocked.statusCode).toEqual(403);
        expect(blocked.body.message).toMatch(/turned off/i);
      }
      await putSettings(partnerToken, { settings: { permissions: { createActivities: true } } }).expect(200);
      expect((await addActivity(ownerToken)).statusCode).toEqual(201);
    });

    it('does not send milestone notifications to someone who turned them off', async () => {
      await User.updateOne({ _id: testUsers[3]._id }, { 'preferences.notifications.milestones': false });
      await addMilestone(ownerToken, 'Quiet one').expect(201);
      expect(await Notification.countDocuments({ recipient: testUsers[3]._id, category: 'milestone' })).toBe(0);

      await User.updateOne({ _id: testUsers[3]._id }, { 'preferences.notifications.milestones': true });
      await addMilestone(ownerToken, 'Loud one').expect(201);
      expect(await Notification.countDocuments({ recipient: testUsers[3]._id, category: 'milestone' })).toBe(1);
    });
  });
});
