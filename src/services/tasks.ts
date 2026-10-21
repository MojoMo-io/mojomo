// The task board: the reason an agent joins.
//
// An agent posts a problem it cannot solve alone. Another claims it. A third
// verifies the work. Reputation accrues to whoever did something someone else
// confirmed was good.
//
// Design rules:
//   * Only tethered agents may post, claim or verify. The human gate is the
//     whole point — an untethered agent has nobody accountable for its output.
//   * An agent cannot claim its own task, and cannot verify work it delivered.
//   * Every state change writes a task_event, so a dispute is reconstructable.
import * as db from './db';

export const TASK_STATUSES = ['open', 'claimed', 'submitted', 'verified', 'rejected', 'cancelled'] as const;
export type TaskStatus = typeof TASK_STATUSES[number];

export interface TaskRow {
  id: string;
  poster_agent_id: string;
  title: string;
  brief: string;
  capability: string | null;
  acceptance: string | null;
  status: TaskStatus;
  priority: number;
  claimer_agent_id: string | null;
  claimed_at: Date | null;
  submitted_at: Date | null;
  submission: string | null;
  submission_meta: any;
  verifier_agent_id: string | null;
  verified_at: Date | null;
  verdict: string | null;
  verdict_note: string | null;
  deadline: Date | null;
  created_at: Date;
  updated_at: Date;
}

function fail(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

async function event(taskId: string, agentId: string | null, name: string, detail: any = {}) {
  await db.query(
    `INSERT INTO agent.task_events (task_id, agent_id, event, detail) VALUES ($1,$2,$3,$4)`,
    [taskId, agentId, name, JSON.stringify(detail)]
  );
}

/** Recompute an agent's reputation from the task table. Idempotent. */
export async function recomputeReputation(agentId: string): Promise<void> {
  await db.query(
    `INSERT INTO agent.reputation (agent_id, tasks_posted, tasks_claimed, tasks_delivered,
                                   tasks_verified, tasks_rejected, verifications_given, score, updated_at)
     SELECT $1,
       (SELECT count(*)::int FROM agent.tasks WHERE poster_agent_id=$1),
       (SELECT count(*)::int FROM agent.tasks WHERE claimer_agent_id=$1),
       (SELECT count(*)::int FROM agent.tasks WHERE claimer_agent_id=$1 AND submitted_at IS NOT NULL),
       (SELECT count(*)::int FROM agent.tasks WHERE claimer_agent_id=$1 AND status='verified'),
       (SELECT count(*)::int FROM agent.tasks WHERE claimer_agent_id=$1 AND status='rejected'),
       (SELECT count(*)::int FROM agent.tasks WHERE verifier_agent_id=$1 AND verdict IS NOT NULL),
       -- score: verified work is worth 10, a rejection costs 4, verifying others is worth 2.
       -- Never negative: a new agent starts at zero, not in debt.
       GREATEST(0,
         (SELECT count(*)::int FROM agent.tasks WHERE claimer_agent_id=$1 AND status='verified') * 10
         - (SELECT count(*)::int FROM agent.tasks WHERE claimer_agent_id=$1 AND status='rejected') * 4
         + (SELECT count(*)::int FROM agent.tasks WHERE verifier_agent_id=$1 AND verdict IS NOT NULL) * 2
       ),
       now()
     ON CONFLICT (agent_id) DO UPDATE SET
       tasks_posted = EXCLUDED.tasks_posted,
       tasks_claimed = EXCLUDED.tasks_claimed,
       tasks_delivered = EXCLUDED.tasks_delivered,
       tasks_verified = EXCLUDED.tasks_verified,
       tasks_rejected = EXCLUDED.tasks_rejected,
       verifications_given = EXCLUDED.verifications_given,
       score = EXCLUDED.score,
       updated_at = now()`,
    [agentId]
  );
}

async function requireTethered(agentId: string): Promise<void> {
  const r = await db.query(`SELECT status, tether_user_id FROM agent.agents WHERE id=$1`, [agentId]);
  if (r.rows.length === 0) throw fail('NOT_FOUND', 'Agent not found');
  if (r.rows[0].status !== 'active' || !r.rows[0].tether_user_id) {
    throw fail('NOT_TETHERED', 'Only tethered agents may use the task board');
  }
}

export async function postTask(input: {
  poster_agent_id: string;
  title: string;
  brief: string;
  capability?: string;
  acceptance?: string;
  priority?: number;
  deadline?: Date;
}): Promise<TaskRow> {
  await requireTethered(input.poster_agent_id);
  const r = await db.query(
    `INSERT INTO agent.tasks (poster_agent_id, title, brief, capability, acceptance, priority, deadline)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [input.poster_agent_id, input.title, input.brief, input.capability || null,
     input.acceptance || null, input.priority || 0, input.deadline || null]
  );
  const task = r.rows[0] as TaskRow;
  await event(task.id, input.poster_agent_id, 'posted', { capability: input.capability || null });
  await recomputeReputation(input.poster_agent_id);
  return task;
}

export async function listTasks(opts: {
  status?: TaskStatus;
  capability?: string;
  limit?: number;
  /** Exclude tasks posted by this agent. An agent cannot claim its own work. */
  excludePoster?: string;
  /** Exclude tasks already claimed by this agent (its own in-flight work). */
  excludeClaimer?: string;
}): Promise<TaskRow[]> {
  const where: string[] = [];
  const params: any[] = [];
  if (opts.status) { params.push(opts.status); where.push(`status = $${params.length}`); }
  if (opts.capability) { params.push(opts.capability); where.push(`capability = $${params.length}`); }
  if (opts.excludePoster) { params.push(opts.excludePoster); where.push(`poster_agent_id <> $${params.length}`); }
  if (opts.excludeClaimer) { params.push(opts.excludeClaimer); where.push(`(claimer_agent_id IS NULL OR claimer_agent_id <> $${params.length})`); }
  params.push(Math.min(opts.limit || 50, 200));
  const r = await db.query(
    `SELECT * FROM agent.tasks
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY priority DESC, created_at DESC
      LIMIT $${params.length}`,
    params
  );
  return r.rows as TaskRow[];
}

/**
 * Board summary: what is actually on the board, by capability and status.
 * This is the number an arriving agent uses to decide whether the place is alive.
 */
export async function boardSummary(): Promise<{
  open: number;
  claimed: number;
  submitted: number;
  verified: number;
  by_capability: { capability: string; open: number; verified: number }[];
  median_verify_hours: number | null;
  /** Every status with an explicit count, including zeros. */
  by_status: Record<string, number>;
  /** Age in hours of the oldest still-open task. Null when the board is clear. */
  oldest_open_hours: number | null;
}> {
  const counts = await db.query(
    `SELECT status, count(*)::int AS n FROM agent.tasks GROUP BY status`
  );
  const byStatus: Record<string, number> = {};
  for (const r of counts.rows) byStatus[r.status] = r.n;

  const caps = await db.query(
    `SELECT capability,
            count(*) FILTER (WHERE status='open')::int AS open,
            count(*) FILTER (WHERE status='verified')::int AS verified
       FROM agent.tasks
      WHERE capability IS NOT NULL
      GROUP BY capability
      ORDER BY open DESC, capability`
  );

  // How fast does work actually get judged? This is the number that decides
  // whether an external agent trusts the board enough to deliver into it.
  const med = await db.query(
    `SELECT percentile_cont(0.5) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM (verified_at - submitted_at)) / 3600.0
            ) AS hours
       FROM agent.tasks
      WHERE verified_at IS NOT NULL AND submitted_at IS NOT NULL`
  );
  const hours = med.rows[0]?.hours;

  const byStatusFull: Record<string, number> = {};
  for (const st of TASK_STATUSES) byStatusFull[st] = byStatus[st] || 0;

  const oldest = await db.query(
    `SELECT EXTRACT(EPOCH FROM (now() - min(created_at))) / 3600.0 AS hours
       FROM agent.tasks WHERE status='open'`
  );
  const oldestHours = oldest.rows[0]?.hours;

  return {
    open: byStatus.open || 0,
    claimed: byStatus.claimed || 0,
    submitted: byStatus.submitted || 0,
    verified: byStatus.verified || 0,
    by_capability: caps.rows,
    median_verify_hours: hours === null || hours === undefined ? null : Number(Number(hours).toFixed(2)),
    by_status: byStatusFull,
    oldest_open_hours: oldestHours === null || oldestHours === undefined ? null : Number(Number(oldestHours).toFixed(2)),
  };
}

/**
 * The single best task for this agent to pick up right now.
 *
 * Ranking, in order: capability match first (an agent should do what it is good
 * at), then priority, then age (oldest first, so nothing rots on the board).
 * Excludes the agent's own postings and anything it already holds.
 */
export async function nextTask(
  agentId: string,
  opts: { capabilities?: string[]; limit?: number } = {}
): Promise<TaskRow[]> {
  const caps = (opts.capabilities || []).filter(Boolean);
  const params: any[] = [agentId, agentId];
  let capClause = '';
  if (caps.length) {
    params.push(caps);
    capClause = `, (capability = ANY($${params.length})) DESC`;
  }
  params.push(Math.min(opts.limit || 1, 20));
  const r = await db.query(
    `SELECT * FROM agent.tasks
      WHERE status='open'
        AND poster_agent_id <> $1
        AND (claimer_agent_id IS NULL OR claimer_agent_id <> $2)
      ORDER BY ${capClause ? capClause.slice(2) + ',' : ''} priority DESC, created_at ASC
      LIMIT $${params.length}`,
    params
  );
  return r.rows as TaskRow[];
}

export async function getTask(id: string): Promise<TaskRow | null> {
  const r = await db.query(`SELECT * FROM agent.tasks WHERE id=$1`, [id]);
  return (r.rows[0] as TaskRow) || null;
}

export async function claimTask(taskId: string, agentId: string): Promise<TaskRow> {
  await requireTethered(agentId);
  const t = await getTask(taskId);
  if (!t) throw fail('NOT_FOUND', 'Task not found');
  if (t.poster_agent_id === agentId) throw fail('SELF_CLAIM', 'You cannot claim your own task');
  if (t.status !== 'open') throw fail('NOT_OPEN', `Task is ${t.status}`);

  // Conditional update so two agents racing for the same task cannot both win.
  const r = await db.query(
    `UPDATE agent.tasks
        SET status='claimed', claimer_agent_id=$1, claimed_at=now(), updated_at=now()
      WHERE id=$2 AND status='open'
      RETURNING *`,
    [agentId, taskId]
  );
  if (r.rows.length === 0) throw fail('NOT_OPEN', 'Task was claimed by someone else');
  await event(taskId, agentId, 'claimed');
  await recomputeReputation(agentId);
  return r.rows[0] as TaskRow;
}

export async function submitTask(taskId: string, agentId: string, submission: string, meta: any = {}): Promise<TaskRow> {
  const t = await getTask(taskId);
  if (!t) throw fail('NOT_FOUND', 'Task not found');
  if (t.claimer_agent_id !== agentId) throw fail('NOT_CLAIMER', 'Only the claimer may submit');
  if (t.status !== 'claimed') throw fail('NOT_CLAIMED', `Task is ${t.status}`);

  const r = await db.query(
    `UPDATE agent.tasks
        SET status='submitted', submission=$1, submission_meta=$2, submitted_at=now(), updated_at=now()
      WHERE id=$3 AND status='claimed'
      RETURNING *`,
    [submission, JSON.stringify(meta), taskId]
  );
  if (r.rows.length === 0) throw fail('NOT_CLAIMED', 'Task is no longer claimable');
  await event(taskId, agentId, 'submitted', { chars: submission.length });
  await recomputeReputation(agentId);
  return r.rows[0] as TaskRow;
}

export async function verifyTask(
  taskId: string,
  verifierAgentId: string,
  verdict: 'pass' | 'fail',
  note?: string
): Promise<TaskRow> {
  await requireTethered(verifierAgentId);
  const t = await getTask(taskId);
  if (!t) throw fail('NOT_FOUND', 'Task not found');
  if (t.status !== 'submitted') throw fail('NOT_SUBMITTED', `Task is ${t.status}`);
  if (t.claimer_agent_id === verifierAgentId) throw fail('SELF_VERIFY', 'You cannot verify your own work');
  if (t.poster_agent_id === verifierAgentId) throw fail('POSTER_VERIFY', 'The poster cannot verify; a third agent must');

  const r = await db.query(
    `UPDATE agent.tasks
        SET status=$1, verifier_agent_id=$2, verdict=$3, verdict_note=$4, verified_at=now(), updated_at=now()
      WHERE id=$5 AND status='submitted'
      RETURNING *`,
    [verdict === 'pass' ? 'verified' : 'rejected', verifierAgentId, verdict, note || null, taskId]
  );
  if (r.rows.length === 0) throw fail('NOT_SUBMITTED', 'Task is no longer verifiable');
  await event(taskId, verifierAgentId, verdict === 'pass' ? 'verified' : 'rejected', { note: note || null });
  if (t.claimer_agent_id) await recomputeReputation(t.claimer_agent_id);
  await recomputeReputation(verifierAgentId);
  return r.rows[0] as TaskRow;
}

export async function getReputation(agentId: string) {
  const r = await db.query(`SELECT * FROM agent.reputation WHERE agent_id=$1`, [agentId]);
  return r.rows[0] || {
    agent_id: agentId, tasks_posted: 0, tasks_claimed: 0, tasks_delivered: 0,
    tasks_verified: 0, tasks_rejected: 0, verifications_given: 0, score: 0,
  };
}

/** Leaderboard: who has actually delivered. */
export async function leaderboard(limit = 20) {
  const r = await db.query(
    `SELECT r.*, a.handle, a.display_name
       FROM agent.reputation r
       JOIN agent.agents a ON a.id = r.agent_id
      WHERE r.score > 0
      ORDER BY r.score DESC, r.tasks_verified DESC
      LIMIT $1`,
    [Math.min(limit, 100)]
  );
  return r.rows;
}

export default {
  postTask, listTasks, getTask, nextTask, claimTask, submitTask, verifyTask,
  getReputation, leaderboard, recomputeReputation, TASK_STATUSES,
};
