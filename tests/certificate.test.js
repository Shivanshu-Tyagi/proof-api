import request from 'supertest';
import mongoose from 'mongoose';
import { jest } from '@jest/globals';
import app from '../server.js';
import User from '../models/User.js';
import Relationship from '../models/Relationship.js';
import Certificate from '../models/Certificate.js';
import Milestone from '../models/Milestone.js';

process.env.JWT_SECRET = 'test_jwt_secret';
const TEST_DB = 'mongodb://localhost:27017/relationshipapp_test_certificate';

describe('certificate artwork', () => {
  let a; let b; let c; let cert; let number;
  const signup = async (n, first) => (await request(app).post('/api/auth/signup').send({
    username: `cert${n}`, email: `cert${n}@secret-mail.test`, password: 'Password123', firstName: first, lastName: 'Holder'
  })).body;
  const as = (who, req) => req.set('Authorization', `Bearer ${who.token}`);
  // supertest only fills res.text for text types, so read image bodies ourselves
  const readBody = (r, cb) => { const chunks = []; r.on('data', (d) => chunks.push(d)); r.on('end', () => cb(null, Buffer.concat(chunks))); };
  const svgOf = (req) => req.buffer(true).parse(readBody).then((res) => ({ status: res.statusCode, type: res.headers['content-type'], text: res.body.toString('utf8') }));

  beforeAll(async () => {
    await mongoose.connect(TEST_DB);
    await Promise.all([User, Relationship, Certificate, Milestone].map((m) => m.deleteMany({})));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    a = await signup('a', 'Maya'); b = await signup('b', 'Jonas'); c = await signup('c', 'Outsider');
    const rel = await Relationship.create({ initiator: a.user.id, partner: b.user.id, title: 'Weekend hikers', type: 'friend', status: 'active' });
    const res = await as(a, request(app).post(`/api/certificates/relationship/${rel.id}/generate`));
    expect(res.statusCode).toEqual(201);
    cert = res.body.certificate;
    number = (await Certificate.findById(cert._id)).metadata.certificateNumber;
  });
  afterAll(async () => { await mongoose.connection.close(); jest.restoreAllMocks(); });

  it('shows holders the artwork with names, relationship, level and number', async () => {
    const res = await svgOf(as(b, request(app).get(`/api/certificates/${cert._id}/image`)));
    expect(res.status).toEqual(200);
    expect(res.type).toMatch(/image\/svg\+xml/);
    expect(res.text).toContain('Maya Holder');
    expect(res.text).toContain('Jonas Holder');
    expect(res.text).toContain('Weekend hikers');
    expect(res.text).toContain('GOLD');
    expect(res.text).toContain(number);
    expect(res.text).toContain('proof');
    expect(res.text).not.toContain('RelationApp');
  });

  it('keeps the artwork to its holders', async () => {
    expect((await request(app).get(`/api/certificates/${cert._id}/image`)).statusCode).toEqual(401);
    expect((await as(c, request(app).get(`/api/certificates/${cert._id}/image`))).statusCode).toEqual(403);
    expect((await as(c, request(app).get(`/api/certificates/${cert._id}/download`))).statusCode).toEqual(403);
    expect((await as(a, request(app).get('/api/certificates/not-an-id/image'))).statusCode).toEqual(404);
  });

  it('downloads a real PNG and counts it', async () => {
    const res = await as(a, request(app).get(`/api/certificates/${cert._id}/download`).buffer(true).parse(readBody));
    expect(res.statusCode).toEqual(200);
    expect(res.headers['content-type']).toEqual('image/png');
    expect(res.headers['content-disposition']).toContain(`certificate-${cert._id}.png`);
    expect(res.body.subarray(0, 4).toString('hex')).toEqual('89504e47');
    expect(res.body.length).toBeGreaterThan(20000);
    expect((await Certificate.findById(cert._id)).stats.downloadCount).toEqual(1);
  });

  it('only serves the public artwork once the link is on, and it reveals less', async () => {
    expect((await request(app).get(`/api/verify/${number}/image`)).statusCode).toEqual(404);

    await as(a, request(app).put(`/api/certificates/${cert._id}/sharing`)).send({ isPublic: true });
    const res = await svgOf(request(app).get(`/api/verify/${number}/image`));
    expect(res.status).toEqual(200);
    expect(res.type).toMatch(/image\/svg\+xml/);
    expect(res.text).toContain('Maya Holder');
    expect(res.text).toContain('GOLD');
    expect(res.text).not.toContain('Weekend hikers');
    expect(res.text).not.toContain('Together since');
    expect(res.text).not.toContain('secret-mail.test');

    await as(a, request(app).put(`/api/certificates/${cert._id}/sharing`)).send({ isPublic: false });
    expect((await request(app).get(`/api/verify/${number}/image`)).statusCode).toEqual(404);
  });

  it('escapes names so they cannot break the artwork', async () => {
    await User.updateOne({ _id: a.user.id }, { firstName: '<b>&"Maya' });
    const res = await svgOf(as(a, request(app).get(`/api/certificates/${cert._id}/image`)));
    expect(res.text).toContain('&lt;b&gt;&amp;&quot;Maya');
    expect(res.text).not.toContain('<b>');
  });

  it('completing a milestone with a certificate reward issues a milestone certificate', async () => {
    const rel = await Relationship.findOne({ title: 'Weekend hikers' });
    const created = await as(a, request(app).post('/api/milestones')).send({
      relationshipId: rel.id, title: 'Finish the ridge trail', description: 'd', category: 'achievement', difficulty: 'hard',
      rewards: { certificate: true, points: 100 }
    });
    expect(created.statusCode).toEqual(201);
    const done = await as(a, request(app).post(`/api/milestones/${created.body.milestone._id}/complete`));
    expect(done.statusCode).toEqual(200);

    const issued = await Certificate.findOne({ relatedTo: 'milestone' });
    expect(issued).toBeTruthy();
    expect(issued.level).toEqual('gold');
    expect(issued.metadata.issuedBy).toEqual('Proof');

    const art = await svgOf(as(b, request(app).get(`/api/certificates/${issued._id}/image`)));
    expect(art.status).toEqual(200);
    expect(art.text).toContain('of Achievement');
    expect(art.text).toContain('Finish the ridge trail');
    expect(art.text).toContain('GOLD');
    expect(art.text).toMatch(/Completed \d{1,2} \w+ \d{4}/);
  });
});
