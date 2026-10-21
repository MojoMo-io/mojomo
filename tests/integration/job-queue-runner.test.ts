// startJobQueue / processNextBatch / stopJobQueue against the real test DB with Claude mocked.
import { v4 as uuidv4 } from 'uuid';
import * as db from '../../src/services/db';
jest.mock('../../src/services/telegram', () => ({ verifyTelegramChat: jest.fn().mockResolvedValue(false), sendTelegramNotification: jest.fn().mockResolvedValue(true) }));
jest.mock('../../src/services/reasoning', () => ({ ...jest.requireActual('../../src/services/reasoning'), callReasoning: jest.fn() }));
import * as reasoning from '../../src/services/reasoning';
import { startJobQueue, stopJobQueue, queueMessageForProcessing } from '../../src/services/job-queue';

const mocked = reasoning.callReasoning as jest.Mock;
const userId = uuidv4(), a1 = uuidv4(), a2 = uuidv4();
let convId: string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  await db.query('INSERT INTO mojomo.users (id, email) VALUES ($1,$2)', [userId, `jq-${Date.now()}@test.com`]);
  await db.query('INSERT INTO mojomo.avatars (id,user_id,name,avatar_type) VALUES ($1,$3,$4,$6),($2,$3,$5,$6)', [a1, a2, userId, 'JQ A', 'JQ B', 'individual']);
  convId = uuidv4();
  await db.query(`INSERT INTO mojomo.conversations (id, initiator_avatar_id, target_avatar_id, title, total_tokens, ownership_ledger, participant_avatar_ids)
                  VALUES ($1,$2,$3,'jq',1000,$4::jsonb,$5)`, [convId, a1, a2, JSON.stringify({ [a1]: { token_balance: 500, ownership_pct: 50 }, [a2]: { token_balance: 500, ownership_pct: 50 } }), [a1, a2]]);
  await db.query(`INSERT INTO mojomo.conversation_messages (conversation_id, avatar_id, message_content, message_type) VALUES ($1,$2,'seed','user_message')`, [convId, a1]);
});
afterAll(async () => { await stopJobQueue(); await db.query('DELETE FROM mojomo.users WHERE id = $1', [userId]); });

async function enqueue() {
  const logId = uuidv4();
  await db.query(`INSERT INTO mojomo.reasoning_logs (id, conversation_id, prompt, status) VALUES ($1,$2,'p','pending')`, [logId, convId]);
  const q = await db.query(`INSERT INTO mojomo.message_queue (conversation_id, reasoning_logs_id, status) VALUES ($1,$2,'pending') RETURNING id`, [convId, logId]);
  return { logId, jobId: q.rows[0].id as string };
}

test('running queue picks up pending jobs, completes them, and is idempotent to start twice', async () => {
  mocked.mockResolvedValue({ response: { themes: [], insights: ['x'], quality_score: 5, next_steps: [], tensions: [], idea_score: 0.2, idea_hypothesis: '' }, tokensUsed: 10, cost: 0 });
  const { jobId } = await enqueue();
  await startJobQueue(50, 2);
  await startJobQueue(50, 2); // second call is a no-op
  for (let i = 0; i < 60; i++) { const s = (await db.query('SELECT status FROM mojomo.message_queue WHERE id=$1', [jobId])).rows[0].status; if (s === 'completed') break; await sleep(50); }
  const row = (await db.query('SELECT status, attempts FROM mojomo.message_queue WHERE id=$1', [jobId])).rows[0];
  expect(row.status).toBe('completed'); expect(row.attempts).toBe(1);
  await stopJobQueue();
});

test('after stopJobQueue nothing is processed; jobs at max_attempts are never picked up', async () => {
  await stopJobQueue();
  mocked.mockClear();
  const { jobId } = await enqueue();
  await db.query('UPDATE mojomo.message_queue SET attempts = max_attempts WHERE id = $1', [jobId]);
  const fresh = await enqueue();
  await sleep(200);
  expect(mocked).not.toHaveBeenCalled();
  await startJobQueue(50, 5);
  for (let i = 0; i < 60; i++) { const s = (await db.query('SELECT status FROM mojomo.message_queue WHERE id=$1', [fresh.jobId])).rows[0].status; if (s === 'completed') break; await sleep(50); }
  await stopJobQueue();
  expect((await db.query('SELECT status FROM mojomo.message_queue WHERE id=$1', [fresh.jobId])).rows[0].status).toBe('completed');
  expect((await db.query('SELECT status FROM mojomo.message_queue WHERE id=$1', [jobId])).rows[0].status).toBe('pending'); // exhausted job skipped
});

test('queueMessageForProcessing inserts a pending row and swallows DB errors', async () => {
  const before = (await db.query('SELECT count(*)::int n FROM mojomo.message_queue WHERE conversation_id=$1', [convId])).rows[0].n;
  await queueMessageForProcessing('m', convId);
  const after = (await db.query('SELECT count(*)::int n FROM mojomo.message_queue WHERE conversation_id=$1', [convId])).rows[0].n;
  expect(after).toBe(before + 1);
  await expect(queueMessageForProcessing('m', '00000000-0000-0000-0000-000000000000')).resolves.toBeUndefined(); // FK violation logged, not thrown
});
