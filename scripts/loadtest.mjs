// Load test for the API. It makes USERS accounts (paired into relationships, with messages) and then has every
// one of them ask for their notifications, messages and relationships over and over, as fast as the server answers.
//
//   BASE=http://localhost:5058 USERS=200 DURATION=30 node scripts/loadtest.mjs
//
// Only point it at a server and database you can throw away: it creates accounts. For a local test, start the server with
//   NODE_ENV=production AUTH_RATE_LIMIT_MAX=100000 USER_RATE_LIMIT_MAX=10000000 API_RATE_LIMIT_MAX=10000000 ...
// and pass SERVER_PID=<its process id> to also see the server's CPU and memory.
import { execFileSync } from 'child_process';
import autocannon from 'autocannon';

const BASE = process.env.BASE || 'http://localhost:5058';
const USERS = Math.max(2, Number(process.env.USERS) || 200) & ~1; // an even number, so everyone has a partner
const DURATION = Number(process.env.DURATION) || 30;
const run = Math.random().toString(36).slice(2, 7);
const API = `${BASE}/api`;

const call = async (method, path, { token, body } = {}) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};

const inBatches = async (items, size, fn) => {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
};

console.log(`Creating ${USERS} people (${USERS / 2} pairs) with messages...`);
const people = await inBatches(Array.from({ length: USERS }, (_, i) => i), 10, async (i) => {
  const r = await call('POST', '/auth/signup', { body: { username: `load${run}${i}`, email: `load${run}${i}@example.com`, password: 'LoadTest12345', firstName: `Load${i}`, lastName: 'Test' } });
  if (r.status !== 201) throw new Error(`sign-up ${i} failed: ${r.status} ${JSON.stringify(r.json).slice(0, 100)}`);
  return { token: r.json.token, id: r.json.user.id };
});

const pairs = await inBatches(Array.from({ length: USERS / 2 }, (_, i) => i), 10, async (i) => {
  const a = people[i * 2]; const b = people[i * 2 + 1];
  const rel = await call('POST', '/relationships', { token: a.token, body: { partnerId: b.id, title: `Pair ${i}`, type: 'friend' } });
  const relId = rel.json.relationship._id;
  await call('POST', `/relationships/${relId}/accept`, { token: b.token });
  for (let m = 0; m < 5; m += 1) await call('POST', `/messages/${relId}`, { token: m % 2 ? b.token : a.token, body: { text: `Message ${m} in pair ${i}` } });
  return relId;
});
people.forEach((p, i) => { p.relId = pairs[Math.floor(i / 2)]; });
console.log('Ready. Hitting the API for', DURATION, 'seconds with', USERS, 'people at once...\n');

// ONLY=unread,threads,me,relationships,thread tests just those requests, to see which one is the expensive one
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const requestsFor = (p) => [
  { name: 'unread', method: 'GET', path: '/api/notifications/unread-count' },
  { name: 'threads', method: 'GET', path: '/api/messages' },
  { name: 'me', method: 'GET', path: '/api/auth/me' },
  { name: 'relationships', method: 'GET', path: '/api/relationships' },
  { name: 'thread', method: 'GET', path: `/api/messages/${p.relId}` },
];

let nextPerson = 0;
const samples = [];
const sampler = process.env.SERVER_PID
  ? setInterval(() => {
      try {
        const [cpu, rss] = execFileSync('ps', ['-o', '%cpu=,rss=', '-p', process.env.SERVER_PID]).toString().trim().split(/\s+/).map(Number);
        samples.push({ cpu, rssMb: rss / 1024 });
      } catch { /* the process ended */ }
    }, 1000)
  : null;

const result = await autocannon({
  url: BASE,
  connections: USERS,
  duration: DURATION,
  setupClient: (client) => {
    const p = people[nextPerson % people.length]; nextPerson += 1;
    client.setHeaders({ Authorization: `Bearer ${p.token}` });
    client.setRequests(requestsFor(p).filter((r) => !ONLY || ONLY.includes(r.name)));
  },
});
if (sampler) clearInterval(sampler);

const rps = result.requests.average;
// A real person with the app open makes about 4 background requests a minute, and fewer once the app slows its checks down
const realisticPerPerson = 4 / 60;
console.log('Requests per second (average):', Math.round(rps));
console.log('Answered OK:', result['2xx'], '| other status codes:', result.non2xx, '| errors:', result.errors, '| timeouts:', result.timeouts);
console.log('Response time (ms): median', result.latency.p50, '| 97.5% under', result.latency.p97_5, '| 99% under', result.latency.p99, '| slowest', result.latency.max);
if (samples.length) {
  console.log('Server CPU: average', Math.round(samples.reduce((s, x) => s + x.cpu, 0) / samples.length) + '%, peak', Math.round(Math.max(...samples.map((x) => x.cpu))) + '%',
    '| memory peak', Math.round(Math.max(...samples.map((x) => x.rssMb))), 'MB');
}
console.log(`\nAt about 4 background requests a minute per open tab, that is roughly ${Math.round(rps / realisticPerPerson).toLocaleString()} people with the app open at once.`);
console.log('(This is the API alone, on this machine, with warm caches. Treat it as an upper bound, not a promise.)');
