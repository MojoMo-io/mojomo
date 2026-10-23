// Human-facing decision requests.
//
// An agent asks its human something; the human answers on mojomo.io. The row is
// the whole protocol — the agent polls it, the human answers it, and the answer
// is what the agent reads back.
import * as db from './db';

export type Kind = 'approve' | 'choose' | 'confirm' | 'freeform';
export type Status = 'pending' | 'answered' | 'expired' | 'withdrawn';
export type Urgency = 'low' | 'normal' | 'high';

export interface Option { id: string; label: string; detail?: string }

export interface DecisionRequest {
  id: string;
  agent_id: string;
  tether_user_id: string;
  kind: Kind;
  title: string;
  body: string | null;
  options: Option[];
  status: Status;
  answer: string | null;
  answer_note: string | null;
  answered_at: Date | null;
  source: string;
  conversation_id: string | null;
  task_id: string | null;
  urgency: Urgency;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
}

/** Max pending requests one agent may have open at once. */
export const MAX_PENDING_PER_AGENT = 10;
/** Max requests one agent may create in a rolling 24h. */
export const MAX_PER_DAY_PER_AGENT = 40;
/** Default lifetime. */
export const DEFAULT_TTL_HOURS = 72;

export class DecisionError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function normaliseOptions(kind: Kind, raw: any): Option[] {
  const arr = Array.isArray(raw) ? raw : [];
  const clean: Option[] = arr
    .filter((o: any) => o && typeof o.id === 'string' && typeof o.label === 'string')
    .slice(0, 12)
    .map((o: any) => ({
      id: String(o.id).slice(0, 64),
      label: String(o.label).slice(0, 120),
      ...(o.detail ? { detail: String(o.detail).slice(0, 400) } : {}),
    }));

  if (kind === 'approve' || kind === 'confirm') {
    if (clean.length === 0) {
      return [
        { id: 'yes', label: kind === 'approve' ? 'Approve' : 'Confirm' },
        { id: 'no', label: kind === 'approve' ? 'Decline' : 'Deny' },
      ];
    }
  }
  if (kind === 'choose' && clean.length < 2) {
    throw new DecisionError('BAD_OPTIONS', 'A "choose" request needs at least two options.');
  }
  if (kind === 'freeform' && clean.length) {
    throw new DecisionError('BAD_OPTIONS', 'A "freeform" request takes no options.');
  }
  return clean;
}

export async function create(input: {
  agentId: string;
  kind: Kind;
  title: string;
  body?: string;
  options?: any;
  source?: string;
  conversationId?: string | null;
  taskId?: string | null;
  urgency?: Urgency;
  ttlHours?: number;
}): Promise<DecisionRequest> {
  const agent = await db.query(
    `SELECT id, status, tether_user_id, display_name, handle FROM agent.agents WHERE id=$1`,
    [input.agentId]
  );
  const a = agent.rows[0];
  if (!a) throw new DecisionError('NOT_FOUND', 'Agent not found.', 404);
  if (a.status !== 'active' || !a.tether_user_id) {
    throw new DecisionError('NOT_TETHERED', 'This agent is not tethered to a human.', 403);
  }

  const title = String(input.title || '').trim();
  if (!title) throw new DecisionError('BAD_TITLE', 'title is required.');
  if (title.length > 200) throw new DecisionError('BAD_TITLE', 'title must be 200 characters or fewer.');

  const kind = input.kind;
  if (!['approve', 'choose', 'confirm', 'freeform'].includes(kind)) {
    throw new DecisionError('BAD_KIND', 'kind must be one of approve, choose, confirm, freeform.');
  }
  const options = normaliseOptions(kind, input.options);

  // Rate limits. An agent that can nag indefinitely trains its human to ignore
  // the badge, which defeats the point of the channel.
  const open = await db.query(
    `SELECT count(*)::int AS n FROM agent.decision_requests
      WHERE agent_id=$1 AND status='pending' AND expires_at > now()`,
    [input.agentId]
  );
  if (open.rows[0].n >= MAX_PENDING_PER_AGENT) {
    throw new DecisionError(
      'TOO_MANY_PENDING',
      `This agent already has ${MAX_PENDING_PER_AGENT} unanswered requests. Wait for an answer before asking again.`,
      429
    );
  }
  const day = await db.query(
    `SELECT count(*)::int AS n FROM agent.decision_requests
      WHERE agent_id=$1 AND created_at > now() - interval '24 hours'`,
    [input.agentId]
  );
  if (day.rows[0].n >= MAX_PER_DAY_PER_AGENT) {
    throw new DecisionError('RATE_LIMITED', 'This agent has asked too many questions today.', 429);
  }

  const ttl = Math.min(Math.max(Number(input.ttlHours) || DEFAULT_TTL_HOURS, 1), 24 * 14);

  const res = await db.query(
    `INSERT INTO agent.decision_requests
       (agent_id, tether_user_id, kind, title, body, options, source,
        conversation_id, task_id, urgency, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10, now() + ($11 || ' hours')::interval)
     RETURNING *`,
    [
      input.agentId, a.tether_user_id, kind, title,
      input.body ? String(input.body).slice(0, 4000) : null,
      JSON.stringify(options),
      input.source || 'agent',
      input.conversationId || null,
      input.taskId || null,
      input.urgency || 'normal',
      String(ttl),
    ]
  );
  const created = res.rows[0];

  // Fire and forget: a Telegram outage must never stop an agent from asking.
  if (created.urgency === 'high') {
    console.log('[decision] urgent request created, notifying', created.id);
    import('./decisionNotify')
      .then(m => m.notifyIfUrgent(created))
      .then(async ok => {
        if (ok) await db.query(`UPDATE agent.decision_requests SET notified_at=now() WHERE id=$1`, [created.id]);
      })
      .catch(e => console.error('decision notify failed:', e?.message || e));
  }

  return created;
}

export async function listForUser(userId: string, opts: { includeAnswered?: boolean } = {}) {
  const res = await db.query(
    `SELECT d.*, a.handle, a.display_name, a.avatar_id
       FROM agent.decision_requests d
       JOIN agent.agents a ON a.id = d.agent_id
      WHERE d.tether_user_id = $1
        AND ($2::boolean OR d.status = 'pending')
      ORDER BY (d.status='pending') DESC, d.created_at DESC
      LIMIT 200`,
    [userId, !!opts.includeAnswered]
  );
  return res.rows;
}

export async function listForAgent(agentId: string, opts: { status?: Status } = {}) {
  const res = await db.query(
    `SELECT * FROM agent.decision_requests
      WHERE agent_id = $1 AND ($2::text IS NULL OR status = $2)
      ORDER BY created_at DESC LIMIT 100`,
    [agentId, opts.status || null]
  );
  return res.rows;
}

export async function getById(id: string) {
  const res = await db.query(`SELECT * FROM agent.decision_requests WHERE id=$1`, [id]);
  return res.rows[0] || null;
}

/**
 * Answer a request. Only the human it was addressed to may answer, and only
 * while it is still pending and unexpired.
 */
export async function answer(input: {
  id: string;
  userId: string;
  answer: string;
  note?: string;
}): Promise<DecisionRequest> {
  const req = await getById(input.id);
  if (!req) throw new DecisionError('NOT_FOUND', 'Request not found.', 404);
  if (req.tether_user_id !== input.userId) {
    throw new DecisionError('FORBIDDEN', 'This request is not addressed to you.', 403);
  }
  if (req.status === 'answered') throw new DecisionError('ALREADY_ANSWERED', 'Already answered.', 409);
  if (req.status === 'withdrawn') throw new DecisionError('WITHDRAWN', 'The agent withdrew this request.', 409);
  if (req.status === 'expired' || new Date(req.expires_at) < new Date()) {
    await db.query(`UPDATE agent.decision_requests SET status='expired' WHERE id=$1 AND status='pending'`, [req.id]);
    throw new DecisionError('EXPIRED', 'This request has expired.', 410);
  }

  const answer = String(input.answer ?? '').trim();
  if (!answer) throw new DecisionError('BAD_ANSWER', 'answer is required.');
  if (answer.length > 2000) throw new DecisionError('BAD_ANSWER', 'answer must be 2000 characters or fewer.');

  const opts: Option[] = Array.isArray(req.options) ? req.options : [];
  if (opts.length && !opts.some(o => o.id === answer)) {
    throw new DecisionError('BAD_ANSWER', `answer must be one of: ${opts.map(o => o.id).join(', ')}`);
  }

  // One transaction: the request must not be marked answered unless the gated
  // task is updated too. A partial commit leaves a task permanently blocked
  // with no way to re-answer.
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const res = await client.query(
      `UPDATE agent.decision_requests
          SET status='answered', answer=$1, answer_note=$2, answered_at=now(), updated_at=now()
        WHERE id=$3 AND status='pending'
        RETURNING *`,
      [answer, input.note ? String(input.note).slice(0, 2000) : null, req.id]
    );
    if (!res.rows[0]) {
      await client.query('ROLLBACK');
      throw new DecisionError('ALREADY_ANSWERED', 'Already answered.', 409);
    }
    const answered = res.rows[0];

    if (answered.task_id) {
      const approved = answered.answer === 'yes';
      await client.query(
        `UPDATE agent.tasks
            SET human_approved_at = CASE WHEN $1 THEN now() ELSE NULL END,
                human_approved_by = CASE WHEN $1 THEN $2::uuid ELSE NULL END,
                updated_at = now()
          WHERE id = $3 AND approval_request_id = $4`,
        [approved, input.userId, answered.task_id, answered.id]
      );
    }

    await client.query('COMMIT');
    return answered;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function withdraw(id: string, agentId: string) {
  const res = await db.query(
    `UPDATE agent.decision_requests SET status='withdrawn', updated_at=now()
      WHERE id=$1 AND agent_id=$2 AND status='pending' RETURNING *`,
    [id, agentId]
  );
  if (!res.rows[0]) throw new DecisionError('NOT_FOUND', 'No pending request with that id.', 404);
  return res.rows[0];
}

/** Sweep expired requests. Called on a timer. */
export async function expireStale(): Promise<number> {
  const res = await db.query(
    `UPDATE agent.decision_requests SET status='expired', updated_at=now()
      WHERE status='pending' AND expires_at < now() RETURNING id`
  );
  return res.rowCount || 0;
}

/** Count of pending requests for a human — drives the nav badge. */
export async function pendingCount(userId: string): Promise<number> {
  const res = await db.query(
    `SELECT count(*)::int AS n FROM agent.decision_requests
      WHERE tether_user_id=$1 AND status='pending' AND expires_at > now()`,
    [userId]
  );
  return res.rows[0].n;
}
