// Spec Phase 2 / Sprint 5.1: reasoning result -> ai_response message -> idea extraction (> 0.65)
// Runs against the real mojomo_test database; Claude is mocked so no network/cost.
import request from 'supertest';
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as db from '../../src/services/db';

jest.mock('../../src/services/telegram', () => ({
  verifyTelegramChat: jest.fn().mockResolvedValue(false),
  sendTelegramNotification: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../src/services/claude', () => {
  const actual = jest.requireActual('../../src/services/claude');
  return { ...actual, callClaudeReasoning: jest.fn() };
});

import * as claude from '../../src/services/claude';
import { processJob } from '../../src/services/job-queue';
import { composeResponseText, resolveIdeaScore, IDEA_THRESHOLD } from '../../src/services/reasoning-outcome';
import { extractIdeaFromMessage } from '../../src/services/ideas';
import conversationRoutes from '../../src/routes/conversations';
import messageRoutes from '../../src/routes/messages';
import ideaRoutes from '../../src/routes/ideas';
import reasoningRoutes from '../../src/routes/reasoning';

const mockedClaude = claude.callClaudeReasoning as jest.Mock;
const HIGH = {
  themes: ['tokenomics'], insights: ['dilution keeps ownership at 100%'], quality_score: 8,
  next_steps: ['model 10 joins'], tensions: [],
  idea_score: 0.82,
  idea_hypothesis: 'IDEA: Replace the reserve pool with proportional dilution so ownership always sums to 100%.\nWorks for any specialist count.',
};
const LOW = { themes: ['chit-chat'], insights: [], quality_score: 2, next_steps: [], tensions: [], idea_score: 0.3, idea_hypothesis: '' };

let app: express.Application;
const userId = uuidv4(); const a1 = uuidv4(); const a2 = uuidv4();
let convId: string;

async function newConversation(title: string): Promise<string> {
  const res = await request(app).post('/api/conversations')
    .send({ initiator_avatar_id: a1, target_avatar_id: a2, title, total_tokens: 1000 }).expect(201);
  const id = res.body.id || res.body.conversation?.id;
  await request(app).post(`/api/conversations/${id}/messages`)
    .send({ avatar_id: a1, message_content: 'What if we used dilution instead of a reserve pool?', message_type: 'user_message' }).expect(201);
  return id;
}
async function enqueue(id: string) {
  const res = await request(app).post(`/api/conversations/${id}/reasoning`).send({});
  expect([200, 201, 202]).toContain(res.status);
  const q = await db.query('SELECT id, conversation_id, reasoning_logs_id, status, attempts FROM mojomo.message_queue WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1', [id]);
  expect(q.rows.length).toBe(1);
  return q.rows[0];
}

beforeAll(async () => {
  app = express(); app.use(express.json());
  app.use('/api', conversationRoutes); app.use('/api', messageRoutes); app.use('/api', ideaRoutes); app.use('/api', reasoningRoutes);
  await db.query('INSERT INTO mojomo.users (id, email) VALUES ($1, $2)', [userId, `ro-${Date.now()}@test.com`]);
  await db.query('INSERT INTO mojomo.avatars (id, user_id, name, avatar_type) VALUES ($1,$2,$3,$4), ($5,$2,$6,$4)', [a1, userId, 'RO A', 'individual', a2, 'RO B']);
});
afterAll(async () => {
  await db.query('DELETE FROM mojomo.users WHERE id = $1', [userId]); // cascades avatars -> conversations -> messages/ideas/logs/queue
});
beforeEach(() => mockedClaude.mockReset());

describe('pure helpers', () => {
  test('composeResponseText leads with the IDEA: hypothesis', () => {
    const t = composeResponseText(HIGH as any);
    expect(t.startsWith('IDEA: Replace the reserve pool')).toBe(true);
    expect(t).toContain('Insights:');
  });
  test('composeResponseText adds IDEA: prefix when model omits it', () => {
    expect(composeResponseText({ ...HIGH, idea_hypothesis: 'no prefix here' } as any).startsWith('IDEA: no prefix')).toBe(true);
  });
  test('resolveIdeaScore prefers model score, clamps to 0..1', () => {
    expect(resolveIdeaScore({ ...HIGH, idea_score: 1.7 } as any, 'x')).toBe(1);
    expect(resolveIdeaScore({ ...HIGH, idea_score: -2 } as any, 'x')).toBe(0);
    expect(resolveIdeaScore(HIGH as any, 'x')).toBe(0.82);
  });
  test('resolveIdeaScore falls back to keyword heuristic (0..1) when model omits it', () => {
    const s = resolveIdeaScore({ ...HIGH, idea_score: undefined } as any, 'I have an innovative idea and a hypothesis.');
    expect(s).toBeGreaterThan(0); expect(s).toBeLessThanOrEqual(1);
  });
  test('threshold is the spec value', () => expect(IDEA_THRESHOLD).toBe(0.65));
});

describe('processJob end-to-end (mocked Claude, real DB)', () => {
  test('high idea_score: stores ai_response, extracts idea, completes job', async () => {
    convId = await newConversation('RO high');
    const job = await enqueue(convId);
    mockedClaude.mockResolvedValue({ response: HIGH, tokensUsed: 500, cost: 0.01 });
    await processJob(job);
    expect(mockedClaude).toHaveBeenCalledTimes(1);

    const log = (await db.query('SELECT status, tokens_used FROM mojomo.reasoning_logs WHERE id = $1', [job.reasoning_logs_id])).rows[0];
    expect(log.status).toBe('completed'); expect(log.tokens_used).toBe(500);
    const q = (await db.query('SELECT status, attempts, result FROM mojomo.message_queue WHERE id = $1', [job.id])).rows[0];
    expect(q.status).toBe('completed'); expect(q.attempts).toBe(1);

    const msgs = (await db.query("SELECT id, avatar_id, idea_score, message_content FROM mojomo.conversation_messages WHERE conversation_id = $1 AND message_type = 'ai_response'", [convId])).rows;
    expect(msgs.length).toBe(1);
    expect(Number(msgs[0].idea_score)).toBeCloseTo(0.82, 2);
    expect(msgs[0].avatar_id).toBe(a1);
    expect(msgs[0].message_content.startsWith('IDEA:')).toBe(true);

    const ideas = (await db.query('SELECT title, full_hypothesis, confidence_score, maturity_stage, extracted_from_message_id FROM mojomo.idea_repository WHERE conversation_id = $1', [convId])).rows;
    expect(ideas.length).toBe(1);
    expect(ideas[0].title).toMatch(/^Replace the reserve pool/);
    expect(Number(ideas[0].confidence_score)).toBeCloseTo(0.82, 2);
    expect(ideas[0].maturity_stage).toBe('seedling');
    expect(ideas[0].extracted_from_message_id).toBe(msgs[0].id);
    const qres = typeof q.result === 'string' ? JSON.parse(q.result) : q.result; expect(qres.idea_id).toBeTruthy();
  });

  test('idea is visible and updatable through the ideas API', async () => {
    const list = await request(app).get(`/api/conversations/${convId}/ideas`).expect(200);
    const arr = Array.isArray(list.body) ? list.body : list.body.ideas;
    expect(arr.length).toBe(1);
    const ideaId = arr[0].id;
    const one = await request(app).get(`/api/conversations/${convId}/ideas/${ideaId}`).expect(200);
    expect(JSON.stringify(one.body)).toContain('Replace the reserve pool');
    const upd = await request(app).patch(`/api/conversations/${convId}/ideas/${ideaId}`).send({ maturity_stage: 'exploring' }).expect(200);
    expect(JSON.stringify(upd.body)).toContain('exploring');
    await request(app).get(`/api/conversations/${convId}/ideas-by-maturity/exploring`).expect(200);
  });

  test('same message cannot create a duplicate idea (ON CONFLICT)', async () => {
    const msg = (await db.query("SELECT id, message_content FROM mojomo.conversation_messages WHERE conversation_id = $1 AND message_type = 'ai_response'", [convId])).rows[0];
    const again = await extractIdeaFromMessage(convId, msg.id, a1, msg.message_content, 0.9);
    expect(again).toBeNull();
    const n = (await db.query('SELECT count(*)::int AS n FROM mojomo.idea_repository WHERE conversation_id = $1', [convId])).rows[0].n;
    expect(n).toBe(1);
  });

  test('low idea_score: stores ai_response but extracts nothing', async () => {
    const id = await newConversation('RO low');
    const job = await enqueue(id);
    mockedClaude.mockResolvedValue({ response: LOW, tokensUsed: 100, cost: 0.001 });
    await processJob(job);
    const msgs = (await db.query("SELECT idea_score FROM mojomo.conversation_messages WHERE conversation_id = $1 AND message_type = 'ai_response'", [id])).rows;
    expect(msgs.length).toBe(1); expect(Number(msgs[0].idea_score)).toBeCloseTo(0.3, 2);
    const n = (await db.query('SELECT count(*)::int AS n FROM mojomo.idea_repository WHERE conversation_id = $1', [id])).rows[0].n;
    expect(n).toBe(0);
  });

  test('Claude failure: log marked error, job returns to pending with one attempt, fails after max_attempts', async () => {
    const id = await newConversation('RO fail');
    let job = await enqueue(id);
    mockedClaude.mockRejectedValue(new Error('simulated 529 overloaded'));
    await processJob(job);
    let q = (await db.query('SELECT status, attempts, max_attempts, error_message FROM mojomo.message_queue WHERE id = $1', [job.id])).rows[0];
    expect(q.attempts).toBe(1);
    expect(q.error_message).toContain('simulated');
    const log = (await db.query('SELECT status, error_message FROM mojomo.reasoning_logs WHERE id = $1', [job.reasoning_logs_id])).rows[0];
    expect(log.status).toBe('error');
    // exhaust retries
    for (let i = q.attempts; i < q.max_attempts; i++) {
      job = { ...job, attempts: i };
      await processJob(job);
    }
    q = (await db.query('SELECT status, attempts, max_attempts FROM mojomo.message_queue WHERE id = $1', [job.id])).rows[0];
    expect(q.attempts).toBe(q.max_attempts);
    expect(q.status).toBe('failed');
    expect(mockedClaude).toHaveBeenCalledTimes(q.max_attempts);
    const n = (await db.query("SELECT count(*)::int AS n FROM mojomo.conversation_messages WHERE conversation_id = $1 AND message_type = 'ai_response'", [id])).rows[0].n;
    expect(n).toBe(0);
  });

  test('POST /reasoning does not process inline (queue owns processing)', async () => {
    const id = await newConversation('RO inline');
    mockedClaude.mockResolvedValue({ response: HIGH, tokensUsed: 1, cost: 0 });
    await enqueue(id);
    await new Promise((r) => setTimeout(r, 300));
    expect(mockedClaude).not.toHaveBeenCalled();
    const q = (await db.query('SELECT status FROM mojomo.message_queue WHERE conversation_id = $1', [id])).rows[0];
    expect(q.status).toBe('pending');
  });
});
