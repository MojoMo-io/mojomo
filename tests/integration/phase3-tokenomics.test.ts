// Spec Phase 3 (two-party model): vesting boundaries, payout validation & concurrency,
// forfeiture at partial vesting, ended-conversation guards, dormancy sweep, specialist flag.
import request from 'supertest';
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as db from '../../src/services/db';
jest.mock('../../src/services/telegram', () => ({ verifyTelegramChat: jest.fn().mockResolvedValue(false), sendTelegramNotification: jest.fn().mockResolvedValue(true) }));
import conversationRoutes from '../../src/routes/conversations';
import payoutRoutes from '../../src/routes/payouts';
import messageRoutes from '../../src/routes/messages';
import specialistRoutes from '../../src/routes/specialists';
import reasoningRoutes from '../../src/routes/reasoning';
import conversationEndRoutes from '../../src/routes/conversation-end';
import { checkAndEndDormantConversations, startDormantScheduler, stopDormantScheduler } from '../../src/services/forfeiture';

const Z = '00000000-0000-0000-0000-000000000000';
const DAY = 24 * 60 * 60 * 1000;
let app: express.Application;
const userId = uuidv4(); const a1 = uuidv4(); const a2 = uuidv4(); const spec = uuidv4();

async function conv(title: string, ageDays = 0): Promise<string> {
  const res = await request(app).post('/api/conversations').send({ initiator_avatar_id: a1, target_avatar_id: a2, title, total_tokens: 1000 }).expect(201);
  const id = res.body.id;
  if (ageDays) await db.query('UPDATE mojomo.conversations SET created_at = NOW() - ($2::text || \' days\')::interval WHERE id = $1', [id, String(ageDays)]);
  return id;
}
const vesting = (id: string, av = a1) => request(app).get(`/api/conversations/${id}/avatars/${av}/vesting`).expect(200);
const payout = (id: string, amount: number, av = a1) => request(app).post('/api/payouts/initiate').send({ avatar_id: av, conversation_id: id, token_amount: amount });

beforeAll(async () => {
  app = express(); app.use(express.json());
  for (const r of [conversationRoutes, payoutRoutes, messageRoutes, specialistRoutes, reasoningRoutes, conversationEndRoutes]) app.use('/api', r);
  await db.query('INSERT INTO mojomo.users (id, email) VALUES ($1,$2)', [userId, `p3-${Date.now()}@test.com`]);
  await db.query('INSERT INTO mojomo.avatars (id,user_id,name,avatar_type) VALUES ($1,$4,$5,$7),($2,$4,$6,$7),($3,$4,$8,$9)', [a1, a2, spec, userId, 'P3 A', 'P3 B', 'individual', 'P3 Spec', 'specialist']);
});
afterAll(async () => { stopDormantScheduler(); await db.query('DELETE FROM mojomo.users WHERE id = $1', [userId]); });

describe('vesting boundaries (30-day linear, genesis 700/300)', () => {
  test.each([[0, 0, 0], [15, 50, 350], [30, 100, 700], [45, 100, 700]])('day %i -> vested %i%%, available %i', async (days, pct, avail) => {
    const id = await conv(`vest ${days}`, days);
    const res = await vesting(id);
    expect(Number(res.body.vested_pct)).toBeCloseTo(pct, 0);
    expect(Number(res.body.available_tokens)).toBeCloseTo(avail, 0);
    expect(Number(res.body.locked_tokens)).toBeCloseTo(700 - avail, 0);
    expect(Number(res.body.total_tokens)).toBe(700);
  });
  test('day 3 is ~10% with 2-decimal rounding', async () => {
    const id = await conv('vest 3', 3);
    const res = await vesting(id);
    expect(Number(res.body.vested_pct)).toBeCloseTo(10, 0);
    expect(Number(res.body.days_elapsed)).toBe(3);
  });
});

describe('payout validation', () => {
  test('fully vested: payout succeeds, ledger + event written, remaining shrinks, over-draw rejected', async () => {
    const id = await conv('pay full', 31);
    const ok = await payout(id, 300).expect(201);
    expect(ok.body.status).toBe('pending'); expect(Number(ok.body.amount)).toBe(300);
    const v = await vesting(id);
    expect(Number(v.body.paid_out_tokens)).toBe(300);
    expect(Number(v.body.available_tokens)).toBe(400);
    const over = await payout(id, 400.01).expect(400);
    expect(over.body.error).toMatch(/Already paid out: 300/);
    await payout(id, 400).expect(201);
    await payout(id, 0.01).expect(400);
    const led = (await db.query("SELECT count(*)::int n FROM mojomo.token_ledger WHERE conversation_id=$1 AND event_type='payout_initiated'", [id])).rows[0].n;
    expect(led).toBe(2);
    const list = await request(app).get(`/api/conversations/${id}/payouts`).expect(200);
    expect((Array.isArray(list.body) ? list.body : list.body.payouts).length).toBe(2);
    await request(app).get(`/api/payouts/${ok.body.payout_id}`).expect(200);
  });
  test('half vested: can withdraw exactly the vested half, not a cent more', async () => {
    const id = await conv('pay half', 15);
    await payout(id, 350.01).expect(400);
    await payout(id, 350).expect(201);
    await payout(id, 0.01).expect(400);
  });
  test('co-creator has an independent balance', async () => {
    const id = await conv('pay both', 31);
    await payout(id, 700, a1).expect(201);
    await payout(id, 300, a2).expect(201);
    await payout(id, 1, a2).expect(400);
  });
  test('avatar not in conversation -> 404-class error', async () => {
    const id = await conv('pay outsider', 31);
    const res = await payout(id, 1, spec);
    expect([400, 404]).toContain(res.status);
  });
});

describe('concurrent payouts cannot double-spend', () => {
  test('5 simultaneous requests for 300 of 700 vested -> exactly two succeed', async () => {
    const id = await conv('race', 31);
    const results = await Promise.all(Array.from({ length: 5 }, () => payout(id, 300)));
    const codes = results.map((r) => r.status).sort();
    expect(codes.filter((c) => c === 201).length).toBe(2);
    expect(codes.filter((c) => c === 400).length).toBe(3);
    const paid = (await db.query('SELECT COALESCE(SUM(token_amount),0)::float s FROM mojomo.payouts WHERE conversation_id=$1 AND avatar_id=$2', [id, a1])).rows[0].s;
    expect(paid).toBe(600);
  });
  test('20 simultaneous small payouts never exceed the vested total', async () => {
    const id = await conv('race small', 31);
    const results = await Promise.all(Array.from({ length: 20 }, () => payout(id, 50)));
    const ok = results.filter((r) => r.status === 201).length;
    expect(ok).toBe(14); // 14 x 50 = 700 vested
    const paid = (await db.query('SELECT COALESCE(SUM(token_amount),0)::float s FROM mojomo.payouts WHERE conversation_id=$1 AND avatar_id=$2', [id, a1])).rows[0].s;
    expect(paid).toBe(700);
  });
});

describe('forfeiture and ended-conversation rules', () => {
  test('ending at day 15 forfeits half; event + ledger rows written with the reason', async () => {
    const id = await conv('forfeit half', 15);
    const pre = await request(app).get(`/api/conversations/${id}/forfeiture-status`).expect(200);
    expect(Number(pre.body.vested_pct)).toBeCloseTo(50, 0);
    expect(Number(pre.body.total_forfeited)).toBeCloseTo(500, 0);
    const end = await request(app).post(`/api/conversations/${id}/end`).send({ avatar_id: a2 }).expect(200);
    expect(Number(end.body.forfeited_tokens)).toBeCloseTo(500, 0);
    const ev = (await db.query("SELECT event_data FROM mojomo.conversation_events WHERE conversation_id=$1 AND event_type='conversation_ended_with_forfeiture'", [id])).rows;
    expect(ev.length).toBe(1);
    const data = typeof ev[0].event_data === 'string' ? JSON.parse(ev[0].event_data) : ev[0].event_data;
    expect(data.reason).toBe('ended_by_initiator');
    const led = (await db.query("SELECT count(*)::int n FROM mojomo.token_ledger WHERE conversation_id=$1 AND event_type='forfeiture'", [id])).rows[0].n;
    expect(led).toBe(2);
  });
  test('ending at day 31 forfeits nothing and logs plain conversation_ended', async () => {
    const id = await conv('forfeit none', 31);
    const end = await request(app).post(`/api/conversations/${id}/end`).send({ avatar_id: a1 }).expect(200);
    expect(Number(end.body.forfeited_tokens)).toBe(0);
    const ev = (await db.query("SELECT event_type FROM mojomo.conversation_events WHERE conversation_id=$1 AND event_type LIKE 'conversation_ended%'", [id])).rows.map((r: any) => r.event_type);
    expect(ev).toEqual(['conversation_ended']);
  });
  test('vesting is frozen at ended_at: forfeited tokens never become withdrawable', async () => {
    const id = await conv('frozen', 15);
    await request(app).post(`/api/conversations/${id}/end`).send({ avatar_id: a1 }).expect(200);
    // Simulate time passing after the end: created 45d ago, ended 30d ago (15 days of vesting at end)
    await db.query("UPDATE mojomo.conversations SET created_at = NOW() - interval '45 days', ended_at = NOW() - interval '30 days' WHERE id = $1", [id]);
    const v = await vesting(id);
    expect(Number(v.body.vested_pct)).toBeCloseTo(50, 0);
    expect(Number(v.body.available_tokens)).toBeCloseTo(350, 0);
    await payout(id, 350).expect(201);      // vested share is still payable after end
    await payout(id, 0.01).expect(400);     // the forfeited half is not
  });
  test('ended conversation rejects messages, reasoning, specialist joins and a second end (409)', async () => {
    const id = await conv('ended guards', 31);
    await request(app).post(`/api/conversations/${id}/end`).send({ avatar_id: a1 }).expect(200);
    await request(app).post(`/api/conversations/${id}/messages`).send({ avatar_id: a1, message_content: 'late', message_type: 'user_message' }).expect(409);
    await request(app).post(`/api/conversations/${id}/reasoning`).send({}).expect(409);
    await request(app).post(`/api/conversations/${id}/specialists`).send({ specialist_avatar_id: spec }).expect(409);
    await request(app).post(`/api/conversations/${id}/end`).send({ avatar_id: a2 }).expect(409);
  });
});

describe('dormancy sweep (90 days without a message)', () => {
  test('ends dormant conversations with reason dormant_90_days, leaves active ones alone', async () => {
    const dormant = await conv('dormant', 91);
    await db.query('UPDATE mojomo.conversations SET last_message_at = NULL WHERE id = $1', [dormant]);
    const recent = await conv('recent', 91);
    await db.query("UPDATE mojomo.conversations SET last_message_at = NOW() - interval '1 day' WHERE id = $1", [recent]);
    const fresh = await conv('fresh', 0);
    const r = await checkAndEndDormantConversations(90);
    expect(r.ended_count).toBeGreaterThanOrEqual(1);
    const statuses = async (id: string) => (await db.query('SELECT status FROM mojomo.conversations WHERE id=$1', [id])).rows[0].status;
    expect(await statuses(dormant)).toBe('ended');
    expect(await statuses(recent)).toBe('active');
    expect(await statuses(fresh)).toBe('active');
    const ev = (await db.query("SELECT event_data FROM mojomo.conversation_events WHERE conversation_id=$1 AND event_type LIKE 'conversation_ended%'", [dormant])).rows[0].event_data;
    expect((typeof ev === 'string' ? JSON.parse(ev) : ev).reason).toBe('dormant_90_days');
  });
  test('scheduler starts once, runs, and stops cleanly', async () => {
    startDormantScheduler(40, 90, 10);
    startDormantScheduler(40, 90, 10); // idempotent
    await new Promise((r) => setTimeout(r, 120));
    stopDormantScheduler();
    stopDormantScheduler();
  });
});

describe('specialists are a roadmap item', () => {
  test('flag off -> 403 with roadmap note; flag on -> dilution works', async () => {
    const id = await conv('flag');
    const prev = process.env.SPECIALISTS_ENABLED;
    delete process.env.SPECIALISTS_ENABLED;
    const off = await request(app).post(`/api/conversations/${id}/specialists`).send({ specialist_avatar_id: spec }).expect(403);
    expect(off.body.roadmap).toMatch(/roadmap|co-creator/i);
    process.env.SPECIALISTS_ENABLED = 'true';
    await request(app).post(`/api/conversations/${id}/specialists`).send({ specialist_avatar_id: spec }).expect(201);
    process.env.SPECIALISTS_ENABLED = prev;
    const own = await request(app).get(`/api/conversations/${id}/ownership`).expect(200);
    const ledger = own.body.ownership_ledger || own.body.ownership || own.body;
    expect(Number(ledger[a1].ownership_pct)).toBeCloseTo(56, 2);
    expect(Number(ledger[spec].ownership_pct)).toBeCloseTo(20, 2);
  });
});
