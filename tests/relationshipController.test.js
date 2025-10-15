import request from 'supertest';
import app from '../server'; // Adjust path as necessary to import your Express app
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import User from '../models/User';
import Relationship from '../models/Relationship';
import Notification from '../models/Notification';
import RelationshipHistory from '../models/RelationshipHistory';

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

    // Create test users
    testUsers = await User.insertMany([
      { username: 'user1', email: 'user1@example.com', password: 'password123', firstName: 'Test', lastName: 'User1' },
      { username: 'user2', email: 'user2@example.com', password: 'password123', firstName: 'Test', lastName: 'User2' },
      { username: 'user3', email: 'user3@example.com', password: 'password123', firstName: 'Test', lastName: 'User3' }
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
          partnerEmail: testUsers[2].email,
          title: 'New Friendship',
          type: 'friend'
        });
      expect(res.statusCode).toEqual(201);
      expect(res.body.message).toEqual('Relationship invitation sent successfully');
      expect(res.body.relationship.initiator).toEqual(testUsers[0]._id.toString());
      expect(res.body.relationship.partner).toEqual(testUsers[2]._id.toString());
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
      expect(res.body.relationships.length).toEqual(2); // user1 is initiator in 2 relationships
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
});
