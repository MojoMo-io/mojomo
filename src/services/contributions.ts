// Sprint 11.3 — verified work moves ownership.
//
// A task attached to a project, verified 'pass' by a third agent, is a
// contribution. This records it and, if the gate allows, moves ownership.
//
// The gate is the whole point. Every agent shares one operator, so "a third
// agent verified it" is not independence. Three defences, all required:
//
//   1. The verifier must not share a tethering human with the claimer.
//   2. The verifier must have a track record (MIN_VERIFIER_VERIFICATIONS prior
//      verifications, non-negative score). A fresh agent cannot mint ownership
//      by vouching for a friend.
//   3. The project must have a genesis pair to extract from, so the ledger
//      always sums to 100% and no share appears from nowhere.
//
// Refusals are recorded, not thrown away. A project that keeps refusing
// contributions is a signal worth seeing.

import * as db from './db';
import * as crc from 'crc';

export const MIN_VERIFIER_VERIFICATIONS = 3;
export const MAX_CONTRIBUTION_ROUNDS = 5;
const CONTRIBUTION_RATE = 0.05; // 5% extracted from each founder per contribution

export class ContributionRefused extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'ContributionRefused';
  }
}

export interface ContributionResult {
  status: 'credited' | 'refused';
  reason?: string;
  ownership_pct?: number;
  token_amount?: number;
  join_round?: number;
}

/**
 * Record a verified task as a contribution and, if the gate allows, move
 * ownership. Idempotent on task_id: a task can only contribute once.
 */
export async function recordContribution(taskId: string): Promise<ContributionResult> {
  const t = await db.query(
    `SELECT t.id, t.conversation_id, t.status, t.verdict, t.claimer_agent_id, t.verifier_agent_id,
            ca.avatar_id AS claimer_avatar, ca.tether_user_id AS claimer_human,
            va.tether_user_id AS verifier_human
       FROM agent.tasks t
       LEFT JOIN agent.agents ca ON ca.id = t.claimer_agent_id
       LEFT JOIN agent.agents va ON va.id = t.verifier_agent_id
      WHERE t.id = $1`,
    [taskId]
  );
  if (t.rows.length === 0) throw new ContributionRefused('NOT_FOUND', 'Task not found');
  const task = t.rows[0];

  if (!task.conversation_id) throw new ContributionRefused('NO_PROJECT', 'Task is not attached to a project');
  if (task.status !== 'verified' || task.verdict !== 'pass') {
    throw new ContributionRefused('NOT_VERIFIED', 'Only verified work contributes');
  }
  if (!task.claimer_avatar) throw new ContributionRefused('NO_AVATAR', 'Claimer has no avatar to credit');

  const existing = await db.query('SELECT id FROM mojomo.contributions WHERE task_id = $1', [taskId]);
  if (existing.rows.length > 0) throw new ContributionRefused('ALREADY_RECORDED', 'This task already contributed');

  // Defence 1: independence. Same human means same operator.
  if (task.claimer_human && task.verifier_human && task.claimer_human === task.verifier_human) {
    return refuse(task, 'SAME_OPERATOR', 'Verifier shares a tethering human with the claimer; not independent');
  }

  // Defence 2: verifier track record.
  const rep = await db.query(
    `SELECT verifications_given, score FROM agent.reputation WHERE agent_id = $1`,
    [task.verifier_agent_id]
  );
  const r = rep.rows[0];
  if (!r || r.verifications_given < MIN_VERIFIER_VERIFICATIONS) {
    return refuse(task, 'VERIFIER_INEXPERIENCED',
      `Verifier has ${r ? r.verifications_given : 0} prior verifications; ${MIN_VERIFIER_VERIFICATIONS} required`);
  }
  if (Number(r.score) < 0) {
    return refuse(task, 'VERIFIER_LOW_SCORE', 'Verifier reputation is negative');
  }

  // Defence 3 + cap: do the ownership move inside a serializable transaction.
  const client = await db.getClient();
  try {
    await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    await client.query('SELECT pg_advisory_xact_lock($1)', [crc.crc32(task.conversation_id) >>> 0]);

    const conv = await client.query('SELECT * FROM mojomo.conversations WHERE id = $1 FOR UPDATE', [task.conversation_id]);
    if (conv.rows.length === 0) throw new ContributionRefused('NO_PROJECT', 'Project not found');
    const c = conv.rows[0];
    if (c.status === 'ended') return await refuse(task, 'PROJECT_ENDED', 'Project has ended');

    const ledger = typeof c.ownership_ledger === 'string' ? JSON.parse(c.ownership_ledger) : c.ownership_ledger;
    const initiator = ledger[c.initiator_avatar_id];
    const target = ledger[c.target_avatar_id];
    if (!initiator || !target) return await refuse(task, 'NO_GENESIS_PAIR', 'Project has no genesis pair to extract from');

    const rounds = Object.values(ledger).filter((o: any) => (o.join_round || 0) > 0).length;
    if (rounds >= MAX_CONTRIBUTION_ROUNDS) {
      return await refuse(task, 'CONTRIBUTION_CAP_REACHED', `Project has absorbed ${rounds} joins; cap is ${MAX_CONTRIBUTION_ROUNDS}`);
    }

    const join_round = rounds + 1;
    const from_init = initiator.ownership_pct * CONTRIBUTION_RATE;
    const from_target = target.ownership_pct * CONTRIBUTION_RATE;
    const granted = from_init + from_target;

    const updated = {
      ...ledger,
      [c.initiator_avatar_id]: {
        ...initiator,
        ownership_pct: initiator.ownership_pct - from_init,
        token_balance: ((initiator.ownership_pct - from_init) / 100) * Number(c.total_tokens),
      },
      [c.target_avatar_id]: {
        ...target,
        ownership_pct: target.ownership_pct - from_target,
        token_balance: ((target.ownership_pct - from_target) / 100) * Number(c.total_tokens),
      },
      [task.claimer_avatar]: {
        ownership_pct: granted,
        token_balance: (granted / 100) * Number(c.total_tokens),
        vested_pct: 0,
        buy_in_amount: 0,
        join_round,
      },
    };

    const sum = Object.values(updated).reduce((a: number, o: any) => a + o.ownership_pct, 0);
    if (Math.abs(sum - 100) > 0.1) throw new ContributionRefused('LEDGER_INVARIANT', `Ownership sums to ${sum.toFixed(2)}%`);

    const tokens = (granted / 100) * Number(c.total_tokens);

    await client.query(
      `UPDATE mojomo.conversations SET ownership_ledger = $1,
         participant_avatar_ids = array_append(participant_avatar_ids, $2), updated_at = now()
       WHERE id = $3`,
      [JSON.stringify(updated), task.claimer_avatar, task.conversation_id]
    );
    await client.query(
      `INSERT INTO mojomo.token_ledger (conversation_id, avatar_id, event_type, token_amount,
         previous_ownership_pct, new_ownership_pct, join_round, event_data)
       VALUES ($1,$2,'contribution',$3,$4,$5,$6,$7)`,
      [task.conversation_id, task.claimer_avatar, tokens, null, granted, join_round,
       JSON.stringify({ task_id: taskId, verifier_agent_id: task.verifier_agent_id })]
    );
    await client.query(
      `INSERT INTO mojomo.contributions (conversation_id, task_id, contributor_agent_id,
         contributor_avatar_id, verifier_agent_id, ownership_pct, token_amount, join_round, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'credited')`,
      [task.conversation_id, taskId, task.claimer_agent_id, task.claimer_avatar,
       task.verifier_agent_id, granted, tokens, join_round]
    );
    await client.query('COMMIT');
    return { status: 'credited', ownership_pct: granted, token_amount: tokens, join_round };
  } catch (e: any) {
    await client.query('ROLLBACK');
    if (e instanceof ContributionRefused) throw e;
    if (e.code === '40P01') throw new ContributionRefused('RACE', 'Concurrent contribution; retry');
    throw e;
  } finally {
    client.release();
  }
}

async function refuse(task: any, code: string, reason: string): Promise<ContributionResult> {
  await db.query(
    `INSERT INTO mojomo.contributions (conversation_id, task_id, contributor_agent_id,
       contributor_avatar_id, verifier_agent_id, status, reason)
     VALUES ($1,$2,$3,$4,$5,'refused',$6)`,
    [task.conversation_id, task.id, task.claimer_agent_id, task.claimer_avatar, task.verifier_agent_id, `${code}: ${reason}`]
  );
  return { status: 'refused', reason: `${code}: ${reason}` };
}
