// HTTP-level coverage for Phase 1 routes that previously had only arithmetic unit tests.
// Real mojomo_test database; Telegram mocked (no network).
import request from 'supertest';
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as db from '../../src/services/db';

jest.mock('../../src/services/telegram', () => ({
  verifyTelegramChat: jest.fn(),
  sendTelegramNotification: jest.fn().mockResolvedValue(true),
}));
import * as telegram from '../../src/services/telegram';
import avatarRoutes from '../../src/routes/avatars';
import conversationRoutes from '../../src/routes/conversations';
import specialistRoutes from '../../src/routes/specialists';
import payoutRoutes from '../../src/routes/payouts';
import messageRoutes from '../../src/routes/messages';
import ideaRoutes from '../../src/routes/ideas';
import conversationEndRoutes from '../../src/routes/conversation-end';

const verify = telegram.verifyTelegramChat as jest.Mock;
const Z = '00000000-0000-0000-0000-000000000000';
// unique numeric chat ids per run: avatars.telegram_chat_id is UNIQUE
const TG = () => String(Date.now() % 1000000000 + Math.floor(Math.random() * 1000));
const TG557 = TG();
let app: express.Application;
const userId = uuidv4(); const otherUserId = uuidv4(); const a1 = uuidv4(); const a2 = uuidv4(); const a3 = uuidv4(); const outsider = uuidv4();
let convId: string;

beforeAll(async () => {
  app = express(); app.use(express.json());
  // These routers run behind requireAuth in the real app; stand in for it so req.auth is set.
  app.use((req: any, _res, next) => { req.auth = { userId }; next(); });
  for (const r of [avatarRoutes, conversationRoutes, specialistRoutes, payoutRoutes, messageRoutes, ideaRoutes, conversationEndRoutes]) app.use('/api', r);
  await db.query('INSERT INTO mojomo.users (id, email) VALUES ($1, $2)', [userId, `rc-${Date.now()}@test.com`]);
  // `outsider` belongs to a *different* user, so the ownership/leak assertions are meaningful.
  await db.query('INSERT INTO mojomo.users (id, email) VALUES ($1, $2)', [otherUserId, `rc-other-${Date.now()}@test.com`]);
  await db.query(
    'INSERT INTO mojomo.avatars (id, user_id, name, avatar_type) VALUES ($1,$5,$6,$9), ($2,$5,$7,$9), ($3,$5,$8,$10), ($4,$12,$11,$9)',
    [a1, a2, a3, outsider, userId, 'RC A', 'RC B', 'RC Specialist', 'individual', 'specialist', 'RC Outsider', otherUserId]);
  const res = await request(app).post('/api/conversations')
    .send({ initiator_avatar_id: a1, target_avatar_id: a2, title: 'RC conv', total_tokens: 1000 }).expect(201);
  convId = res.body.id || res.body.conversation?.id;
});
afterAll(async () => { await db.query('DELETE FROM mojomo.users WHERE id = ANY($1)', [[userId, otherUserId]]); });
beforeEach(() => verify.mockReset());

describe('avatars', () => {
  test('POST creates avatar for the signed-in user', async () => {
    const res = await request(app).post('/api/avatars').send({ name: 'New One', bio: 'hi' }).expect(201);
    expect(res.body.user_id).toBe(userId); expect(res.body.avatar_type).toBe('individual');
  });
  test('POST with telegram id records verification when bot confirms', async () => {
    verify.mockResolvedValue(true);
    const res = await request(app).post('/api/avatars').send({ name: 'TG User', telegram_chat_id: TG() }).expect(201);
    expect(res.body.telegram_verified_at).toBeTruthy();
  });
  test('POST with telegram id but failed verification still creates avatar unverified', async () => {
    verify.mockResolvedValue(false);
    const res = await request(app).post('/api/avatars').send({ name: 'TG Unverified', telegram_chat_id: TG() }).expect(201);
    expect(res.body.telegram_verified_at).toBeNull();
  });
  test('POST rejects invalid payload', async () => {
    await request(app).post('/api/avatars').set('x-user-id', userId).send({ name: 'x' }).expect(400);
    await request(app).post('/api/avatars').set('x-user-id', userId).send({ name: 'ok name', telegram_chat_id: 'abc' }).expect(400);
  });
  test('GET /avatars/:id 200 and 404', async () => {
    const res = await request(app).get(`/api/avatars/${a1}`).expect(200);
    expect(res.body.id).toBe(a1);
    await request(app).get(`/api/avatars/${Z}`).expect(404);
  });
  test('GET /avatars lists only the signed-in user\'s avatars', async () => {
    const res = await request(app).get('/api/avatars').expect(200);
    const ids = res.body.map((a: any) => a.id);
    expect(ids).toEqual(expect.arrayContaining([a1, a2]));
    expect(ids).not.toContain(outsider); // another user's avatar must not leak
  });
  test('PATCH telegram: 400 unverifiable, 404 unknown avatar, 200 success', async () => {
    verify.mockResolvedValue(false);
    await request(app).patch(`/api/avatars/${a3}/telegram`).send({ telegram_chat_id: '555' }).expect(400);
    verify.mockResolvedValue(true);
    await request(app).patch(`/api/avatars/${Z}/telegram`).send({ telegram_chat_id: '556' }).expect(404);
    const res = await request(app).patch(`/api/avatars/${a3}/telegram`).send({ telegram_chat_id: TG557 }).expect(200);
    expect(String(res.body.telegram_chat_id)).toBe(TG557); expect(res.body.telegram_verified_at).toBeTruthy();
    await request(app).patch(`/api/avatars/${a3}/telegram`).send({ telegram_chat_id: 'nope' }).expect(400);
  });
});

describe('messages', () => {
  test('POST stores participant message', async () => {
    const res = await request(app).post(`/api/conversations/${convId}/messages`)
      .send({ avatar_id: a1, message_content: '  Hello there  ', message_type: 'user_message' }).expect(201);
    expect(JSON.stringify(res.body)).toContain('"Hello there"');
  });
  test('POST rejects non-participant (403), unknown conversation (404), bad body (400)', async () => {
    await request(app).post(`/api/conversations/${convId}/messages`).send({ avatar_id: outsider, message_content: 'hi', message_type: 'user_message' }).expect(403);
    await request(app).post(`/api/conversations/${Z}/messages`).send({ avatar_id: a1, message_content: 'hi', message_type: 'user_message' }).expect(404);
    await request(app).post(`/api/conversations/${convId}/messages`).send({ avatar_id: a1, message_content: 'hi', message_type: 'user_message', idea_score: 50 }).expect(400);
  });
  test('ai_response gets a 0..1 idea_score automatically', async () => {
    const res = await request(app).post(`/api/conversations/${convId}/messages`)
      .send({ avatar_id: a1, message_content: 'I would like to propose an innovative hypothesis and a solution.', message_type: 'ai_response' }).expect(201);
    const score = Number(res.body.idea_score ?? res.body.message?.idea_score);
    expect(score).toBeGreaterThan(0); expect(score).toBeLessThanOrEqual(1);
  });
  test('GET list, GET one (200/404), ideas-messages', async () => {
    const list = await request(app).get(`/api/conversations/${convId}/messages`).expect(200);
    const arr = Array.isArray(list.body) ? list.body : list.body.messages;
    expect(arr.length).toBeGreaterThanOrEqual(2);
    await request(app).get(`/api/conversations/${convId}/messages/${arr[0].id}`).expect(200);
    await request(app).get(`/api/conversations/${convId}/messages/${Z}`).expect(404);
    await request(app).get(`/api/conversations/${convId}/ideas-messages`).expect(200);
  });
});

describe('specialists', () => {
  test('join dilutes and keeps ownership at 100%; duplicate rejected; unknown conversation 404', async () => {
    const res = await request(app).post(`/api/conversations/${convId}/specialists`).send({ specialist_avatar_id: a3 }).expect(201);
    expect(JSON.stringify(res.body)).toContain(a3);
    await request(app).post(`/api/conversations/${convId}/specialists`).send({ specialist_avatar_id: a3 }).expect(400);
    await request(app).post(`/api/conversations/${Z}/specialists`).send({ specialist_avatar_id: a3 }).expect(404);
    await request(app).post(`/api/conversations/${convId}/specialists`).send({}).expect(400);
    const own = await request(app).get(`/api/conversations/${convId}/ownership`).expect(200);
    const ledger = own.body.ownership_ledger || own.body.ownership || own.body;
    const total = Object.values(ledger as Record<string, any>).reduce((s: number, e: any) => s + Number(e.ownership_pct ?? e), 0);
    expect(total).toBeCloseTo(100, 1);
  });
  test('participants lists three sorted by join round', async () => {
    const res = await request(app).get(`/api/conversations/${convId}/participants`).expect(200);
    expect(res.body.total_participants).toBe(3);
    expect(res.body.participants[2].avatar_id).toBe(a3);
    await request(app).get(`/api/conversations/${Z}/participants`).expect(404);
  });
});

describe('payouts + vesting', () => {
  test('vesting status at day 0 is 0% vested; unknown -> 404', async () => {
    const res = await request(app).get(`/api/conversations/${convId}/avatars/${a1}/vesting`).expect(200);
    expect(Number(res.body.vested_pct)).toBe(0);
    await request(app).get(`/api/conversations/${Z}/avatars/${a1}/vesting`).expect(404);
  });
  test('initiate payout blocked while tokens are locked (400), validation (400), unknown (404)', async () => {
    const res = await request(app).post('/api/payouts/initiate').send({ avatar_id: a1, conversation_id: convId, token_amount: 10 }).expect(400);
    expect(res.body.error).toMatch(/Insufficient vested/);
    await request(app).post('/api/payouts/initiate').send({ avatar_id: a1, conversation_id: convId, token_amount: -1 }).expect(400);
    await request(app).post('/api/payouts/initiate').send({ avatar_id: a1, conversation_id: Z, token_amount: 1 }).expect(404);
  });
  test('GET payout 404; list payouts for conversation is empty', async () => {
    await request(app).get(`/api/payouts/${Z}`).expect(404);
    const res = await request(app).get(`/api/conversations/${convId}/payouts`).expect(200);
    const arr = Array.isArray(res.body) ? res.body : res.body.payouts;
    expect(arr.length).toBe(0);
  });
});

describe('ideas (empty conversation)', () => {
  test('list empty, get/patch unknown 404, by-maturity ok, bad stage 400', async () => {
    const list = await request(app).get(`/api/conversations/${convId}/ideas`).expect(200);
    const arr = Array.isArray(list.body) ? list.body : list.body.ideas;
    expect(arr.length).toBe(0);
    await request(app).get(`/api/conversations/${convId}/ideas/${Z}`).expect(404);
    await request(app).patch(`/api/conversations/${convId}/ideas/${Z}`).send({ maturity_stage: 'mature' }).expect(404);
    await request(app).patch(`/api/conversations/${convId}/ideas/${Z}`).send({ maturity_stage: 'bogus' }).expect(400);
    await request(app).get(`/api/conversations/${convId}/ideas-by-maturity/seedling`).expect(200);
  });
});

describe('conversation end + forfeiture', () => {
  test('forfeiture-status before end shows full forfeiture at day 0', async () => {
    const res = await request(app).get(`/api/conversations/${convId}/forfeiture-status`).expect(200);
    expect(Number(res.body.vested_pct)).toBe(0);
    expect(res.body.will_forfeit).toBe(true);
    expect(Number(res.body.total_forfeited)).toBeCloseTo(1000, 0);
    await request(app).get(`/api/conversations/${Z}/forfeiture-status`).expect(404);
  });
  test('only initiator/target may end (403); unknown 404; bad body 400', async () => {
    await request(app).post(`/api/conversations/${convId}/end`).send({ avatar_id: outsider }).expect(403);
    await request(app).post(`/api/conversations/${Z}/end`).send({ avatar_id: a1 }).expect(404);
    await request(app).post(`/api/conversations/${convId}/end`).send({}).expect(400);
  });
  test('initiator ends conversation; forfeiture logged; conversation marked ended', async () => {
    const res = await request(app).post(`/api/conversations/${convId}/end`).send({ avatar_id: a1 }).expect(200);
    expect(JSON.stringify(res.body)).toContain('vested_pct');
    const conv = (await db.query('SELECT status, ended_at FROM mojomo.conversations WHERE id = $1', [convId])).rows[0];
    expect(conv.ended_at).toBeTruthy();
    const ev = (await db.query("SELECT count(*)::int AS n FROM mojomo.conversation_events WHERE conversation_id = $1 AND (event_type ILIKE '%forfeit%' OR event_type ILIKE '%end%')", [convId])).rows[0].n;
    expect(ev).toBeGreaterThan(0);
  });
});
