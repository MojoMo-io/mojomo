// Spec Phase 4 E2E (first build, token economy disabled): avatars -> conversation -> messages ->
// reflection (mocked Claude) -> idea extracted -> refined -> advanced through gated stages -> surfaced.
// Also proves the token-free API surface and that the flag re-enables it.
import request from 'supertest';
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as db from '../../src/services/db';
jest.mock('../../src/services/telegram', () => ({ verifyTelegramChat: jest.fn().mockResolvedValue(false), sendTelegramNotification: jest.fn().mockResolvedValue(true) }));
jest.mock('../../src/services/reasoning', () => ({ ...jest.requireActual('../../src/services/reasoning'), callReasoning: jest.fn() }));
import * as reasoning from '../../src/services/reasoning';
import { processJob } from '../../src/services/job-queue';
import { canTransition, MATURITY_GATES } from '../../src/services/ideas';
import avatarRoutes from '../../src/routes/avatars';
import conversationRoutes from '../../src/routes/conversations';
import messageRoutes from '../../src/routes/messages';
import ideaRoutes from '../../src/routes/ideas';
import reasoningRoutes from '../../src/routes/reasoning';
import payoutRoutes from '../../src/routes/payouts';
import specialistRoutes from '../../src/routes/specialists';
import conversationEndRoutes from '../../src/routes/conversation-end';

const mocked = reasoning.callReasoning as jest.Mock;
const Z = '00000000-0000-0000-0000-000000000000';
let app: express.Application;
const ws1 = uuidv4(), ws2 = uuidv4();          // two workspaces (x-user-id), no signup flow
let creator: string, cocreator: string, outsider: string, convId: string, ideaId: string;
const as = (ws: string) => ({ 'x-user-id': ws });

beforeAll(async () => {
  app = express(); app.use(express.json());
  // Routers run behind requireAuth in the real app. Stand in for it, deriving req.auth from the
  // x-user-id header so the two-workspace journey below still works.
  app.use(async (req: any, _res, next) => {
    const ws = req.headers['x-user-id'];
    if (ws) {
      // Signup is implicit in this journey: the workspace user is created on first use.
      await db.query('INSERT INTO mojomo.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [ws, `${ws}@anonymous.mojomo.io`]);
      req.auth = { userId: ws };
    }
    next();
  });
  for (const r of [avatarRoutes, conversationRoutes, messageRoutes, ideaRoutes, reasoningRoutes, payoutRoutes, specialistRoutes, conversationEndRoutes]) app.use('/api', r);
  process.env.TOKENS_ENABLED = 'false';
});
afterAll(async () => {
  process.env.TOKENS_ENABLED = 'true';
  await db.query('DELETE FROM mojomo.users WHERE id IN ($1, $2)', [ws1, ws2]);
});
beforeEach(() => mocked.mockReset());

describe('pure gate logic (spec: Idea Maturity Progression)', () => {
  test('gates match the spec thresholds', () => {
    expect(MATURITY_GATES).toEqual({ exploring: { min_refinements: 1, min_confidence: 0.65 }, refined: { min_refinements: 2, min_confidence: 0.75 }, mature: { min_refinements: 3, min_confidence: 0.85 } });
  });
  test('seedling -> exploring needs >= 1 refinement and confidence >= 0.65', () => {
    expect(canTransition('seedling', 'exploring', { refinement_count: 0, confidence: 0.9 }).ok).toBe(false);
    expect(canTransition('seedling', 'exploring', { refinement_count: 1, confidence: 0.64 }).ok).toBe(false);
    expect(canTransition('seedling', 'exploring', { refinement_count: 1, confidence: 0.65 }).ok).toBe(true);
  });
  test('exploring -> refined needs >= 2 and 0.75; refined -> mature needs >= 3 and 0.85', () => {
    expect(canTransition('exploring', 'refined', { refinement_count: 2, confidence: 0.75 }).ok).toBe(true);
    expect(canTransition('exploring', 'refined', { refinement_count: 2, confidence: 0.74 }).ok).toBe(false);
    expect(canTransition('refined', 'mature', { refinement_count: 3, confidence: 0.85 }).ok).toBe(true);
    expect(canTransition('refined', 'mature', { refinement_count: 2, confidence: 0.99 }).ok).toBe(false);
  });
  test('no skipping, no going back, no no-op', () => {
    expect(canTransition('seedling', 'refined', { refinement_count: 9, confidence: 1 }).reason).toMatch(/skip/);
    expect(canTransition('refined', 'seedling', { refinement_count: 9, confidence: 1 }).reason).toMatch(/backwards/);
    expect(canTransition('refined', 'refined', { refinement_count: 9, confidence: 1 }).reason).toMatch(/already/);
  });
});

describe('journey: two workspaces, one conversation, one surfaced idea', () => {
  test('creating an avatar works for a freshly signed-up user', async () => {
    const a = await request(app).post('/api/avatars').set(as(ws1)).send({ name: 'Ada', bio: 'creator' }).expect(201);
    const b = await request(app).post('/api/avatars').set(as(ws2)).send({ name: 'Grace' }).expect(201);
    const o = await request(app).post('/api/avatars').set(as(ws2)).send({ name: 'Outsider' }).expect(201);
    creator = a.body.id; cocreator = b.body.id; outsider = o.body.id;
    expect((await db.query('SELECT count(*)::int n FROM mojomo.users WHERE id IN ($1,$2)', [ws1, ws2])).rows[0].n).toBe(2);
  });

  test('conversation is created without any token fields (token economy off)', async () => {
    const res = await request(app).post('/api/conversations').set(as(ws1))
      .send({ initiator_avatar_id: creator, target_avatar_id: cocreator, title: 'Carbon pricing for small ports', description: 'A first exploration' }).expect(201);
    convId = res.body.id;
    expect(res.body).not.toHaveProperty('total_tokens');
    expect(res.body).not.toHaveProperty('ownership_ledger');
    const one = await request(app).get(`/api/conversations/${convId}`).expect(200);
    expect(one.body).not.toHaveProperty('ownership_ledger');
    const list = await request(app).get('/api/conversations').set(as(ws1)).expect(200);
    expect(JSON.stringify(list.body)).not.toMatch(/ownership_ledger|total_tokens/);
  });

  test('token-economy endpoints are roadmap items (403) while the flag is off', async () => {
    for (const p of [`/api/conversations/${convId}/ownership`, `/api/conversations/${convId}/avatars/${creator}/ownership`,
                     `/api/conversations/${convId}/avatars/${creator}/vesting`, `/api/conversations/${convId}/payouts`, `/api/conversations/${convId}/forfeiture-status`]) {
      const r = await request(app).get(p).expect(403); expect(r.body.roadmap).toMatch(/roadmap/i);
    }
    await request(app).post('/api/payouts/initiate').send({ avatar_id: creator, conversation_id: convId, token_amount: 1 }).expect(403);
    await request(app).post(`/api/conversations/${convId}/specialists`).send({ specialist_avatar_id: outsider }).expect(403);
  });

  test('both participants speak; an outsider cannot', async () => {
    await request(app).post(`/api/conversations/${convId}/messages`).send({ avatar_id: creator, message_content: 'What if ports priced carbon per container, not per ship?', message_type: 'user_message' }).expect(201);
    await request(app).post(`/api/conversations/${convId}/messages`).send({ avatar_id: cocreator, message_content: 'Then small carriers pay for what they actually move.', message_type: 'user_message' }).expect(201);
    await request(app).post(`/api/conversations/${convId}/messages`).send({ avatar_id: outsider, message_content: 'hi', message_type: 'user_message' }).expect(403);
  });

  test('reflection is queued, processed, stored as ai_response, and extracts a seedling idea', async () => {
    const r = await request(app).post(`/api/conversations/${convId}/reasoning`).send({}).expect(201);
    expect(r.body).toBeTruthy();
    const job = (await db.query('SELECT id, conversation_id, reasoning_logs_id, status, attempts FROM mojomo.message_queue WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT 1', [convId])).rows[0];
    mocked.mockResolvedValue({ response: {
      themes: ['port carbon pricing'], insights: ['per-container pricing aligns cost with cargo'], quality_score: 8, next_steps: ['model 3 ports'], tensions: [],
      idea_score: 0.7, idea_hypothesis: 'IDEA: Price port carbon per container moved so small carriers pay in proportion to cargo, not vessel size.' }, tokensUsed: 400, cost: 0.01 });
    await processJob(job);
    const ideas = await request(app).get(`/api/conversations/${convId}/ideas`).expect(200);
    const arr = Array.isArray(ideas.body) ? ideas.body : ideas.body.ideas;
    expect(arr.length).toBe(1);
    ideaId = arr[0].id;
    expect(arr[0].maturity_stage).toBe('seedling');
    expect(arr[0].refinement_count).toBe(0);
    expect(Number(arr[0].confidence_score)).toBeCloseTo(0.7, 2);
    const thread = await request(app).get(`/api/conversations/${convId}/messages`).expect(200);
    expect((thread.body.messages || thread.body).some((m: any) => m.message_type === 'ai_response')).toBe(true);
  });

  test('cannot advance without a refinement; outsider cannot refine; mature cannot be skipped to', async () => {
    const r = await request(app).patch(`/api/conversations/${convId}/ideas/${ideaId}`).send({ maturity_stage: 'exploring' }).expect(409);
    expect(r.body.error).toMatch(/requires at least 1 refinement/);
    await request(app).post(`/api/conversations/${convId}/ideas/${ideaId}/refinements`).send({ avatar_id: outsider, note: 'me too' }).expect(403);
    const skip = await request(app).patch(`/api/conversations/${convId}/ideas/${ideaId}`).send({ maturity_stage: 'refined' }).expect(409);
    expect(skip.body.error).toMatch(/skip/);
  });

  test('refine -> exploring -> refine -> refined -> refine -> mature (surfaced), with history and events', async () => {
    // 1st refinement: rewrite hypothesis, confidence 0.7 -> exploring allowed
    const r1 = await request(app).post(`/api/conversations/${convId}/ideas/${ideaId}/refinements`)
      .send({ avatar_id: cocreator, full_hypothesis: 'Price port carbon per container moved; publish the rate quarterly so carriers can plan.', note: 'Added transparency', confidence_score: 0.7 }).expect(201);
    expect(r1.body.idea.refinement_count).toBe(1);
    expect(r1.body.idea.title).toMatch(/^Price port carbon per container moved; publish/);
    await request(app).patch(`/api/conversations/${convId}/ideas/${ideaId}`).send({ maturity_stage: 'exploring' }).expect(200);
    // refined needs 2 & 0.75: one more refinement but low confidence -> blocked on confidence
    await request(app).post(`/api/conversations/${convId}/ideas/${ideaId}/refinements`).send({ avatar_id: creator, note: 'Checked with two port operators', confidence_score: 0.72 }).expect(201);
    const c = await request(app).patch(`/api/conversations/${convId}/ideas/${ideaId}`).send({ maturity_stage: 'refined' }).expect(409);
    expect(c.body.error).toMatch(/confidence >= 0.75/);
    await request(app).post(`/api/conversations/${convId}/ideas/${ideaId}/refinements`).send({ avatar_id: creator, confidence_score: 0.8 }).expect(201);
    await request(app).patch(`/api/conversations/${convId}/ideas/${ideaId}`).send({ maturity_stage: 'refined' }).expect(200);
    // mature needs 3 & 0.85: we have 3 refinements, confidence 0.8 -> blocked; raise confidence
    const m = await request(app).patch(`/api/conversations/${convId}/ideas/${ideaId}`).send({ maturity_stage: 'mature' }).expect(409);
    expect(m.body.error).toMatch(/confidence >= 0.85/);
    await request(app).post(`/api/conversations/${convId}/ideas/${ideaId}/refinements`).send({ avatar_id: cocreator, note: 'Pilot terms agreed', confidence_score: 0.9 }).expect(201);
    const done = await request(app).patch(`/api/conversations/${convId}/ideas/${ideaId}`).send({ maturity_stage: 'mature' }).expect(200);
    expect(done.body.maturity_stage).toBe('mature');
    expect(done.body.surfaced_at).toBeTruthy();
    expect(done.body.refinement_count).toBe(4);
    // history + events
    const hist = await request(app).get(`/api/conversations/${convId}/ideas/${ideaId}/refinements`).expect(200);
    expect(hist.body.refinements.length).toBe(4);
    expect(hist.body.refinements[0].previous_hypothesis).toMatch(/^Price port carbon per container moved so small carriers/);
    const ev = (await db.query("SELECT event_type FROM mojomo.conversation_events WHERE conversation_id=$1 AND event_type LIKE 'idea_%' ORDER BY created_at", [convId])).rows.map((r: any) => r.event_type);
    expect(ev.filter((e: string) => e === 'idea_refined').length).toBe(4);
    expect(ev.filter((e: string) => e === 'idea_maturity_advanced').length).toBe(2);
    expect(ev.filter((e: string) => e === 'idea_surfaced').length).toBe(1);
    // closed after surfacing
    await request(app).post(`/api/conversations/${convId}/ideas/${ideaId}/refinements`).send({ avatar_id: creator, note: 'late' }).expect(409);
    await request(app).patch(`/api/conversations/${convId}/ideas/${ideaId}`).send({ maturity_stage: 'seedling' }).expect(400);
  });

  test('ideas-by-maturity filter and the surfaced payout note', async () => {
    const mature = await request(app).get(`/api/conversations/${convId}/ideas-by-maturity/mature`).expect(200);
    expect(JSON.stringify(mature.body)).toContain(ideaId);
    const surfaced = (await db.query("SELECT event_data FROM mojomo.conversation_events WHERE conversation_id=$1 AND event_type='idea_surfaced'", [convId])).rows[0].event_data;
    expect((typeof surfaced === 'string' ? JSON.parse(surfaced) : surfaced).payout).toMatch(/roadmap/);
  });

  test('ending the conversation returns no token figures and makes it read-only', async () => {
    const end = await request(app).post(`/api/conversations/${convId}/end`).send({ avatar_id: creator });
    if (end.status !== 200) throw new Error(`end failed: ${end.status} ${JSON.stringify(end.body)}`);
    expect(end.body.status).toBe('ended');
    expect(end.body).not.toHaveProperty('vested_pct');
    expect(end.body).not.toHaveProperty('forfeited_tokens');
    await request(app).post(`/api/conversations/${convId}/messages`).send({ avatar_id: creator, message_content: 'one more', message_type: 'user_message' }).expect(409);
  });

  test('flag on: total_tokens becomes required and token fields reappear', async () => {
    process.env.TOKENS_ENABLED = 'true';
    try {
      await request(app).post('/api/conversations').set(as(ws1)).send({ initiator_avatar_id: creator, target_avatar_id: cocreator, title: 'needs tokens' }).expect(400);
      const ok = await request(app).post('/api/conversations').set(as(ws1)).send({ initiator_avatar_id: creator, target_avatar_id: cocreator, title: 'with tokens', total_tokens: 1000 }).expect(201);
      expect(ok.body.total_tokens).toBe(1000);
      expect(ok.body.ownership_ledger).toBeTruthy();
      await request(app).get(`/api/conversations/${ok.body.id}/avatars/${creator}/vesting`).expect(200);
    } finally { process.env.TOKENS_ENABLED = 'false'; }
  });
});
