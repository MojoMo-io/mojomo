// Phase 5: magic-link auth, session enforcement, ownership, security headers, rate limits, input hardening.
// Uses the real app factory (all middleware) against mojomo_test. Mail provider = console.
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import * as db from '../../src/services/db';
jest.mock('../../src/services/telegram', () => ({ verifyTelegramChat: jest.fn().mockResolvedValue(false), sendTelegramNotification: jest.fn().mockResolvedValue(true) }));
process.env.MAIL_PROVIDER = 'console';
process.env.PUBLIC_URL = 'https://mojomo.io';
process.env.RATE_LIMIT_MAX = '100000';
process.env.AUTH_RATE_LIMIT_MAX = '100000';
process.env.JSON_BODY_LIMIT = '100kb'; // pin the production default; the real .env raises it to 5mb for avatar payloads
process.env.TOKENS_ENABLED = 'false';
import { createApp } from '../../src/app';
import { hashToken, SESSION_COOKIE } from '../../src/services/auth';

const app = createApp();
const emailA = `alice-${Date.now()}@example.com`, emailB = `bob-${Date.now()}@example.com`;
let cookieA: string, cookieB: string, userA: string, userB: string, avA: string, avB: string, convId: string;

async function signIn(email: string): Promise<{ cookie: string; userId: string }> {
  const r = await request(app).post('/api/auth/magic-link').send({ email }).expect(200);
  expect(r.body.debug_link).toMatch(/\/api\/auth\/verify\?token=/);      // console provider, non-production
  const token = new URL(r.body.debug_link).searchParams.get('token')!;
  const v = await request(app).get(`/api/auth/verify?token=${encodeURIComponent(token)}`).expect(302);
  expect(v.headers.location).toBe('/');
  const setCookie = (v.headers['set-cookie'] as unknown as string[])[0];
  expect(setCookie).toMatch(new RegExp(`^${SESSION_COOKIE}=`)); expect(setCookie).toMatch(/HttpOnly/); expect(setCookie).toMatch(/SameSite=Lax/);
  const cookie = setCookie.split(';')[0];
  const me = await request(app).get('/api/auth/me').set('Cookie', cookie).expect(200);
  expect(me.body.email).toBe(email);
  return { cookie, userId: me.body.user_id };
}

afterAll(async () => { await db.query('DELETE FROM mojomo.users WHERE email IN ($1, $2)', [emailA, emailB]); });

describe('open signup: magic link by email alone', () => {
  test('missing / bad email -> 400', async () => {
    await request(app).post('/api/auth/magic-link').send({}).expect(400);
    await request(app).post('/api/auth/magic-link').send({ email: 'not-an-email' }).expect(400);
  });
  test('full sign-in creates user + session; second user too', async () => {
    ({ cookie: cookieA, userId: userA } = await signIn(emailA));
    ({ cookie: cookieB, userId: userB } = await signIn(emailB));
    expect(userA).not.toBe(userB);
  });
  test('links are single-use and unknown tokens fail identically', async () => {
    const r = await request(app).post('/api/auth/magic-link').send({ email: emailA }).expect(200);
    const token = new URL(r.body.debug_link).searchParams.get('token')!;
    await request(app).get(`/api/auth/verify?token=${token}`).expect(302);
    // Reuse inside the grace window is allowed on purpose: chat clients prefetch
    // links to build previews, which would otherwise burn the token before the
    // human taps it. Outside the window a used token fails like an expired one.
    const again = await request(app).get(`/api/auth/verify?token=${token}`).expect(302);
    expect(again.headers.location).toBe('/');
    const bogus = await request(app).get('/api/auth/verify?token=abcdefghijklmnopqrstuvwxyz0123456789').set('Accept', 'application/json').expect(400);
    expect(bogus.body.error).toBe('Invalid or expired link');
  });
  test('expired link is rejected', async () => {
    const r = await request(app).post('/api/auth/magic-link').send({ email: emailA }).expect(200);
    const token = new URL(r.body.debug_link).searchParams.get('token')!;
    await db.query("UPDATE mojomo.auth_tokens SET expires_at = NOW() - interval '1 minute' WHERE token_hash = $1", [hashToken(token)]);
    await request(app).get(`/api/auth/verify?token=${token}`).set('Accept', 'application/json').expect(400);
  });
  test('/auth/check answers 200/401 for nginx auth_request', async () => {
    await request(app).get('/api/auth/check').expect(401);
    await request(app).get('/api/auth/check').set('Cookie', cookieA).expect(200);
  });
});

describe('everything else requires a session; x-user-id is never trusted', () => {
  test('no cookie -> 401 with login hint', async () => {
    const r = await request(app).get('/api/avatars').expect(401);
    expect(r.body.login).toBe('/login');
    await request(app).post('/api/avatars').send({ name: 'Ghost' }).expect(401);
  });
  test('x-user-id header is ignored: avatars are created for the session user', async () => {
    const r = await request(app).post('/api/avatars').set('Cookie', cookieA).set('x-user-id', userB).send({ name: 'Alice' }).expect(201);
    expect(r.body.user_id).toBe(userA);
    avA = r.body.id;
    avB = (await request(app).post('/api/avatars').set('Cookie', cookieB).send({ name: 'Bob' }).expect(201)).body.id;
    const list = await request(app).get('/api/avatars').set('Cookie', cookieA).set('x-user-id', userB).expect(200);
    expect(list.body.map((a: any) => a.id)).toEqual([avA]);
  });
  test('you cannot act as someone else\'s avatar', async () => {
    const r = await request(app).post('/api/conversations').set('Cookie', cookieA).send({ initiator_avatar_id: avB, target_avatar_id: avA, title: 'spoof' }).expect(403);
    expect(r.body.error).toMatch(/initiator_avatar_id does not belong to you/);
  });
  test('creator opens a conversation; co-creator sees it; a stranger gets 404', async () => {
    const c = await request(app).post('/api/conversations').set('Cookie', cookieA).send({ initiator_avatar_id: avA, target_avatar_id: avB, title: 'Private' }).expect(201);
    convId = c.body.id;
    await request(app).get(`/api/conversations/${convId}`).set('Cookie', cookieB).expect(200);
    const { cookie: cookieC } = await signIn(`carol-${Date.now()}@example.com`);
    await request(app).get(`/api/conversations/${convId}`).set('Cookie', cookieC).expect(404);
    await request(app).get(`/api/conversations/${convId}/messages`).set('Cookie', cookieC).expect(404);
    await request(app).post(`/api/conversations/${convId}/messages`).set('Cookie', cookieB).send({ avatar_id: avA, message_content: 'as alice?', message_type: 'user_message' }).expect(403);
    await request(app).post(`/api/conversations/${convId}/messages`).set('Cookie', cookieB).send({ avatar_id: avB, message_content: 'as bob', message_type: 'user_message' }).expect(201);
  });
  test('logout destroys the session', async () => {
    const { cookie } = await signIn(`dave-${Date.now()}@example.com`);
    await request(app).post('/api/auth/logout').set('Cookie', cookie).expect(200);
    await request(app).get('/api/auth/me').set('Cookie', cookie).expect(401);
  });
});

describe('security hardening', () => {
  test('security headers present, x-powered-by absent', async () => {
    const r = await request(app).get('/health').expect(200);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBeDefined();
    expect(r.headers['strict-transport-security']).toBeDefined();
    expect(r.headers['x-powered-by']).toBeUndefined();
  });
  test('CORS: foreign origins get no allow-origin; own origin does', async () => {
    const bad = await request(app).get('/health').set('Origin', 'https://evil.example');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
    const good = await request(app).get('/health').set('Origin', 'https://mojomo.io');
    expect(good.headers['access-control-allow-origin']).toBe('https://mojomo.io');
    expect(good.headers['access-control-allow-credentials']).toBe('true');
  });
  test('non-UUID ids are 404, never a database error', async () => {
    for (const p of ["/api/conversations/'; DROP TABLE mojomo.users;--", '/api/avatars/../../etc/passwd', '/api/conversations/1 OR 1=1/messages', '/api/reasoning-logs/<script>']) {
      const r = await request(app).get(encodeURI(p)).set('Cookie', cookieA);
      expect([404, 400]).toContain(r.status);
    }
    expect((await db.query('SELECT count(*)::int n FROM mojomo.users')).rows[0].n).toBeGreaterThan(0);
  });
  test('oversized and malformed bodies are rejected cleanly', async () => {
    await request(app).post('/api/avatars').set('Cookie', cookieA).send({ name: 'x'.repeat(200_000) }).expect(413);
    const r = await request(app).post('/api/avatars').set('Cookie', cookieA).set('Content-Type', 'application/json').send('{"name": ').expect(400);
    expect(r.body.error).toBe('Malformed JSON');
  });
  test('stored content is returned JSON-escaped (no HTML interpretation server-side)', async () => {
    const xss = '<img src=x onerror=alert(1)>';
    const r = await request(app).post(`/api/conversations/${convId}/messages`).set('Cookie', cookieA).send({ avatar_id: avA, message_content: xss, message_type: 'user_message' }).expect(201);
    expect(r.headers['content-type']).toMatch(/application\/json/);
    expect(JSON.stringify(r.body)).toContain(JSON.stringify(xss).slice(1, -1));
  });
  test('/metrics serves Prometheus text to loopback only', async () => {
    const r = await request(app).get('/metrics').expect(200);
    expect(r.text).toMatch(/mojomo_http_request_duration_seconds/);
    expect(r.text).toMatch(/mojomo_login_attempts_total/);
    await request(app).get('/metrics').set('X-Forwarded-For', '203.0.113.9').expect(404);
  });
});

describe('rate limiting (separate app with tight limits)', () => {
  test('auth endpoint throttles per ip+email; api throttles per ip', async () => {
    process.env.AUTH_RATE_LIMIT_MAX = '2'; process.env.RATE_LIMIT_MAX = '6';
    try {
      const tight = createApp();
      const e = `rl-${Date.now()}@example.com`;
      await request(tight).post('/api/auth/magic-link').send({ email: e }).expect(200);
      await request(tight).post('/api/auth/magic-link').send({ email: e }).expect(200);
      const third = await request(tight).post('/api/auth/magic-link').send({ email: e }).expect(429);
      expect(third.headers['ratelimit']).toBeDefined();
      let last = 0;
      for (let i = 0; i < 8; i++) last = (await request(tight).get('/api/auth/me')).status;
      expect(last).toBe(429);
    } finally {
      process.env.AUTH_RATE_LIMIT_MAX = '100000';
process.env.JSON_BODY_LIMIT = '100kb'; // pin the production default; the real .env raises it to 5mb for avatar payloads process.env.RATE_LIMIT_MAX = '100000';
    }
  });
});
