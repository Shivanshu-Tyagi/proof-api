import request from 'supertest';
import mongoose from 'mongoose';
import { jest } from '@jest/globals';
import app from '../server.js';
import User from '../models/User.js';
import Certificate from '../models/Certificate.js';

process.env.JWT_SECRET = 'test_jwt_secret';
// Separate database so other suites cannot wipe this one's data
const TEST_DB = 'mongodb://localhost:27017/relationshipapp_test_verify';

describe('certificate verify link', () => {
  let owner;
  let outsider;
  let certificate;
  let ownerToken;
  let outsiderToken;

  beforeAll(async () => {
    await mongoose.connect(TEST_DB);
    await User.deleteMany({});
    await Certificate.deleteMany({});
    jest.spyOn(console, 'log').mockImplementation(() => {});

    const signup = async (n) => {
      const res = await request(app).post('/api/auth/signup').send({
        username: `verify${n}`, email: `verify${n}@example.com`, password: 'Password123', firstName: `Verify${n}`, lastName: 'Person'
      });
      return res.body;
    };
    const a = await signup('a');
    const b = await signup('b');
    const c = await signup('c');
    owner = a.user; ownerToken = a.token;
    outsider = c.user; outsiderToken = c.token;

    certificate = await Certificate.create({
      relatedTo: 'relationship',
      relatedId: new mongoose.Types.ObjectId(),
      title: 'Certificate of Testing',
      type: 'relationship',
      level: 'gold',
      recipients: [{ user: owner.id }, { user: b.user.id }]
    });
  });

  afterAll(async () => {
    await mongoose.connection.close();
    jest.restoreAllMocks();
  });

  const verify = (number) => request(app).get(`/api/verify/${encodeURIComponent(number)}`);
  const toggle = (token, isPublic, id = certificate._id) =>
    request(app).put(`/api/certificates/${id}/sharing`).set('Authorization', `Bearer ${token}`).send({ isPublic });

  it('does not reveal a certificate that has not been shared', async () => {
    const res = await verify(certificate.metadata.certificateNumber);
    expect(res.statusCode).toEqual(404);
  });

  it('only recipients can switch the link on', async () => {
    expect((await toggle(outsiderToken, true)).statusCode).toEqual(403);
    expect((await toggle(ownerToken, 'yes')).statusCode).toEqual(400);
    expect((await toggle(ownerToken, true)).statusCode).toEqual(200);
  });

  it('shows only names, level and date once shared, case-insensitively', async () => {
    const res = await verify(certificate.metadata.certificateNumber.toLowerCase());
    expect(res.statusCode).toEqual(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.people).toEqual(['Verifya Person', 'Verifyb Person']);
    expect(res.body.level).toEqual('gold');
    expect(Object.keys(res.body).sort()).toEqual(['issuedAt', 'level', 'number', 'people', 'revoked', 'title', 'verified']);
  });

  it('stops working when the link is switched off again', async () => {
    await toggle(ownerToken, false).expect(200);
    expect((await verify(certificate.metadata.certificateNumber)).statusCode).toEqual(404);
  });

  it('reports revoked certificates as not verified', async () => {
    await toggle(ownerToken, true).expect(200);
    await Certificate.updateOne({ _id: certificate._id }, { 'metadata.isRevoked': true });
    const res = await verify(certificate.metadata.certificateNumber);
    expect(res.body.verified).toBe(false);
    expect(res.body.revoked).toBe(true);
  });
});
