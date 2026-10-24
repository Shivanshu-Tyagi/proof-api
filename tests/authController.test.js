import { jest } from '@jest/globals';
import { expect } from 'chai';
import sinon from 'sinon';
import { searchUserByRegistrationId } from '../controllers/authController.js';
import User from '../models/User.js';

describe('authController', () => {
  let findOneStub;

  beforeEach(() => {
    findOneStub = sinon.stub(User, 'findOne');
  });

  afterEach(() => {
    findOneStub.restore();
  });

  describe('searchUserByRegistrationId', () => {
    it('should return 400 if registrationId is missing', async () => {
      const req = { query: {} };
      const res = { status: sinon.stub().returnsThis(), json: sinon.spy() };
      await searchUserByRegistrationId(req, res);

      expect(res.status.calledWith(400)).to.be.true;
      expect(res.json.calledWith({
        message: 'Validation failed',
        errors: [
          {
            type: 'field',
            value: '',
            msg: 'Registration ID must be between 8 and 12 characters',
            path: 'registrationId',
            location: 'query'
          }
        ]
      })).to.be.true;
    });

    it('should return 404 if user not found', async () => {
      findOneStub.returns({ select: sinon.stub().returns(null) });

      const req = { query: { registrationId: 'nonexistent' } };
      const res = { status: sinon.stub().returnsThis(), json: sinon.spy() };
      await searchUserByRegistrationId(req, res);

      expect(res.status.calledWith(404)).to.be.true;
      expect(res.json.calledWith({ message: 'User not found with this registration ID' })).to.be.true;
    });

    it('should return user data if user is found', async () => {
      const mockUser = {
        _id: 'someid',
        username: 'testuser',
        firstName: 'Test',
        lastName: 'User',
        fullName: 'Test User',
        avatar: '',
        registrationId: 'REG12345'
      };
      findOneStub.returns({ select: sinon.stub().returns(mockUser) });

      const req = { query: { registrationId: 'REG12345' } };
      const res = { status: sinon.stub().returnsThis(), json: sinon.spy() };
      await searchUserByRegistrationId(req, res);

      expect(res.status.calledWith(200)).to.be.true;
      expect(res.json.calledWith({
        user: {
          _id: mockUser._id,
          firstName: mockUser.firstName,
          lastName: mockUser.lastName,
          fullName: mockUser.fullName,
          username: mockUser.username,
          avatar: mockUser.avatar,
          bio: mockUser.bio,
          registrationId: mockUser.registrationId
        }
      })).to.be.true;
    });
  });
});







