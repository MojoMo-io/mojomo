// Spec LAYER 4 load test: p50 < 100ms, p95 < 200ms, p99 < 500ms, error rate < 1%, 100 req/s sustained.
// Usage: node tests/load/run.js  (expects server at BASE_URL, default http://localhost:8999, on mojomo_test)
const autocannon = require('autocannon');
const { randomUUID, createHash, randomBytes } = require('crypto');
process.env.DB_NAME = process.env.DB_NAME || 'mojomo_test';
const BASE = process.env.BASE_URL || 'http://localhost:8999';
const RATE = Number(process.env.LOAD_RPS || 100);
const DURATION = Number(process.env.LOAD_SECONDS || 15);
const LIMITS = { p50: 100, p975: 200, p99: 500, errorPct: 1 }; // autocannon reports p97_5, not p95: stricter than the spec's p95<200ms

async function seed() {
  const db = require('../../dist/services/db');
  const userId = randomUUID(), a1 = randomUUID(), a2 = randomUUID();
  await db.query('INSERT INTO mojomo.users (id, email) VALUES ($1,$2)', [userId, `load-${Date.now()}@test.com`]);
  await db.query('INSERT INTO mojomo.avatars (id,user_id,name,avatar_type) VALUES ($1,$3,$4,$6),($2,$3,$5,$6)', [a1, a2, userId, 'Load A', 'Load B', 'individual']);
  // Phase 5: the API requires a session cookie. Mint one directly in the DB for the seeded user.
  const sessionToken = randomBytes(32).toString('base64url');
  await db.query(`INSERT INTO mojomo.sessions (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + interval '1 hour')`, [userId, createHash('sha256').update(sessionToken).digest('hex')]);
  const cookie = `mojomo_session=${sessionToken}`;
  const res = await fetch(`${BASE}/api/conversations`, { method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ initiator_avatar_id: a1, target_avatar_id: a2, title: 'load' }) });
  if (res.status !== 201) throw new Error(`seed conversation failed: ${res.status} ${await res.text()}`);
  const conv = (await res.json()).id;
  return { userId, a1, conv, cookie, cleanup: () => db.query('DELETE FROM mojomo.users WHERE id = $1', [userId]) };
}

function run(title, url, headers = {}, method = 'GET', body) {
  return new Promise((resolve, reject) => {
    autocannon({ url, headers, method, body, connections: 20, overallRate: RATE, duration: DURATION, title }, (err, r) => err ? reject(err) : resolve(r));
  });
}

(async () => {
  const s = await seed();
  const targets = [
    ['GET /health', `${BASE}/health`],
    ['GET /api/auth/me (session lookup)', `${BASE}/api/auth/me`, { cookie: s.cookie }],
    ['GET /api/avatars/:id', `${BASE}/api/avatars/${s.a1}`, { cookie: s.cookie }],
    ['GET /api/avatars (mine)', `${BASE}/api/avatars`, { cookie: s.cookie }],
    ['GET /api/conversations/:id', `${BASE}/api/conversations/${s.conv}`, { cookie: s.cookie }],
    ['GET /api/conversations/:id/ideas', `${BASE}/api/conversations/${s.conv}/ideas`, { cookie: s.cookie }],
    ['GET /api/conversations/:id/messages', `${BASE}/api/conversations/${s.conv}/messages`, { cookie: s.cookie }],
    ['POST /api/conversations/:id/messages (write)', `${BASE}/api/conversations/${s.conv}/messages`, { 'content-type': 'application/json', cookie: s.cookie }, 'POST',
      JSON.stringify({ avatar_id: s.a1, message_content: 'load test message with an idea and a hypothesis', message_type: 'user_message' })],
  ];
  let failed = false;
  console.log(`rate=${RATE} req/s  duration=${DURATION}s  connections=20  base=${BASE}\n`);
  console.log('endpoint'.padEnd(46), 'req/s'.padStart(7), 'p50'.padStart(7), 'p97.5'.padStart(7), 'p99'.padStart(7), 'err%'.padStart(6), ' result');
  for (const [title, url, headers, method, body] of targets) {
    const r = await run(title, url, headers, method, body);
    const total = r.requests.total || 1;
    const non2xx = r.non2xx + r.errors + r.timeouts;
    const errPct = (non2xx / total) * 100;
    const ok = r.latency.p50 < LIMITS.p50 && r.latency.p97_5 < LIMITS.p975 && r.latency.p99 < LIMITS.p99 && errPct < LIMITS.errorPct;
    if (!ok) failed = true;
    console.log(title.padEnd(46), String(r.requests.average.toFixed(0)).padStart(7), `${r.latency.p50}ms`.padStart(7), `${r.latency.p97_5}ms`.padStart(7), `${r.latency.p99}ms`.padStart(7), errPct.toFixed(2).padStart(6), ok ? ' PASS' : ' FAIL');
  }
  await s.cleanup();
  console.log(`\nlimits: p50<${LIMITS.p50}ms p97.5<${LIMITS.p975}ms p99<${LIMITS.p99}ms errors<${LIMITS.errorPct}%  =>  ${failed ? 'LOAD TEST FAILED' : 'LOAD TEST PASSED'}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('load test error:', e.message); process.exit(2); });
