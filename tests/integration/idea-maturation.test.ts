// Automatic idea maturation: ideas advance one gated stage at a time and never skip.
import { v4 as uuidv4 } from 'uuid';
import * as db from '../../src/services/db';
import { advanceIdea, runMaturationSweep } from '../../src/services/ideaMaturation';

const userId = uuidv4(), a1 = uuidv4(), a2 = uuidv4();
let convId: string;

async function makeIdea(confidence: number): Promise<string> {
  const r = await db.query(
    `INSERT INTO mojomo.idea_repository (conversation_id, title, full_hypothesis, extracted_by_avatar_id, maturity_stage, confidence_score)
     VALUES ($1, $2, $3, $4, 'seedling', $5) RETURNING id`,
    [convId, `idea-${uuidv4().slice(0, 8)}`, 'A testable hypothesis about the world.', a1, confidence]
  );
  return r.rows[0].id;
}

beforeAll(async () => {
  await db.query('INSERT INTO mojomo.users (id, email) VALUES ($1,$2)', [userId, `mat-${Date.now()}@test.com`]);
  await db.query('INSERT INTO mojomo.avatars (id,user_id,name,avatar_type) VALUES ($1,$3,$4,$6),($2,$3,$5,$6)',
    [a1, a2, userId, 'Mat A', 'Mat B', 'individual']);
  convId = uuidv4();
  await db.query(`INSERT INTO mojomo.conversations (id, initiator_avatar_id, target_avatar_id, title, total_tokens, ownership_ledger, participant_avatar_ids)
                  VALUES ($1,$2,$3,'mat',1000,$4::jsonb,$5)`,
    [convId, a1, a2, JSON.stringify({ [a1]: { token_balance: 500, ownership_pct: 50 }, [a2]: { token_balance: 500, ownership_pct: 50 } }), [a1, a2]]);
});
afterAll(async () => { await db.query('DELETE FROM mojomo.users WHERE id = $1', [userId]); });

test('a high-confidence seedling advances exactly one stage per call', async () => {
  const id = await makeIdea(0.9);
  const first = await advanceIdea(id);
  expect(first.advanced).toBe(true);
  expect(first.from).toBe('seedling');
  expect(first.to).toBe('exploring');

  const second = await advanceIdea(id);
  expect(second.to).toBe('refined');

  const third = await advanceIdea(id);
  expect(third.to).toBe('mature');

  const fourth = await advanceIdea(id);
  expect(fourth.advanced).toBe(false);
  expect(fourth.reason).toMatch(/already mature/);
});

test('a low-confidence idea stalls rather than being promoted on a timer', async () => {
  const id = await makeIdea(0.2);
  const r = await advanceIdea(id);
  expect(r.advanced).toBe(false);
  expect(r.reason).toMatch(/confidence/);
});

test('system refinements are recorded and attributed, never silently invented', async () => {
  const id = await makeIdea(0.9);
  await advanceIdea(id);
  const refs = await db.query('SELECT note, avatar_id FROM mojomo.idea_refinements WHERE idea_id = $1', [id]);
  expect(refs.rows.length).toBeGreaterThanOrEqual(1);
  expect(refs.rows[0].note).toMatch(/system: automatic maturation/);
  expect(refs.rows[0].avatar_id).toBe(a1);
});

test('sweep advances multiple ideas and reports per-idea outcomes', async () => {
  const hi = await makeIdea(0.9), lo = await makeIdea(0.1);
  const results = await runMaturationSweep(200);
  const byId = new Map(results.map((r) => [r.idea_id, r]));
  expect(byId.get(hi)?.advanced).toBe(true);
  expect(byId.get(lo)?.advanced).toBe(false);
});
