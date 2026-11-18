import crypto from 'crypto';
import * as db from './db';

/**
 * Deterministic JSON: keys sorted recursively.
 *
 * Postgres jsonb does NOT preserve key order - it stores keys sorted by length
 * then bytewise. So a payload hashed at write time with insertion order will
 * never match the same payload read back. Hashing must use a canonical form
 * that is independent of both insertion order and jsonb's reordering.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  // A Date is an object with no enumerable own keys, so without this branch it
  // serialises to {} and the hash silently covers nothing. Dates must be
  // rendered as their ISO string, which is also what jsonb stores.
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
}

export type DecisionEvent =
  | 'created' | 'notified' | 'answered' | 'expired' | 'withdrawn';
export type Actor = 'agent' | 'human' | 'system';

/**
 * Append-only decision event log.
 *
 * agent.audit records HTTP requests. That is not an oversight record: it says
 * a request arrived, not what was decided or who decided it. EU AI Act Art 19
 * (automatically generated logs over the lifetime of the system) and Art 26
 * (deployers keep records of oversight activity) both need the decision, the
 * decision-maker, and evidence the record has not been altered.
 *
 * Each row carries prev_hash (the previous row's row_hash) and row_hash
 * (sha256 of the canonical payload + prev_hash). Altering any row breaks the
 * chain from that point forward, which is detectable by verifyChain().
 *
 * The table has a BEFORE UPDATE OR DELETE trigger that raises. Rows cannot be
 * edited or removed through the application at all.
 */
export async function record(input: {
  decisionId: string;
  agentId: string;
  humanUserId?: string | null;
  event: DecisionEvent;
  actor: Actor;
  detail?: Record<string, unknown>;
}): Promise<void> {
  let client: any;
  try {
    client = await db.getClient();
  } catch (e) {
    console.error('[decisionEvents] no db client', (e as Error).message);
    return;
  }
  try {
    await client.query('BEGIN');
    // Serialise chain writes so two concurrent events cannot both read the
    // same prev_hash and fork the chain.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('agent.decision_events'))`);

    const prev = await client.query(
      `SELECT row_hash FROM agent.decision_events ORDER BY id DESC LIMIT 1`
    );
    const prevHash: string | null = prev.rows[0]?.row_hash ?? null;

    // Serialise detail to a canonical STRING first, then hash that exact string
    // and store that exact string. Hashing a live JS object is unsafe: a Date
    // stringifies one way in JSON.stringify and comes back from jsonb as a
    // plain string, so the object hashed and the object stored are not the
    // same value. Hashing the serialised form removes the ambiguity entirely.
    const detailCanonical = canonical(input.detail ?? {});
    const payload = canonical({
      decision_id: input.decisionId,
      agent_id: input.agentId,
      human_user_id: input.humanUserId ?? null,
      event: input.event,
      actor: input.actor,
      detail: detailCanonical,
      prev_hash: prevHash,
    });
    const rowHash = crypto.createHash('sha256').update(payload).digest('hex');

    await client.query(
      `INSERT INTO agent.decision_events
         (decision_id, agent_id, human_user_id, event, actor, detail, detail_canonical, prev_hash, row_hash)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`,
      [input.decisionId, input.agentId, input.humanUserId ?? null,
       input.event, input.actor, detailCanonical, detailCanonical, prevHash, rowHash]
    );
    await client.query('COMMIT');
  } catch (e) {
    if (client && typeof client.query === 'function') {
      await client.query('ROLLBACK').catch(() => undefined);
    }
    // Never let an audit failure break the user-facing action, but never hide it.
    console.error('[decisionEvents] failed to record', input.event, (e as Error).message);
  } finally {
    if (client && typeof client.release === 'function') client.release();
  }
}

/** Recompute the chain and report the first row that does not match. */
export async function verifyChain(): Promise<{ ok: boolean; checked: number; brokenAt?: number }> {
  const rows = await db.query(
    `SELECT id, decision_id, agent_id, human_user_id, event, actor, detail_canonical, prev_hash, row_hash
       FROM agent.decision_events ORDER BY id ASC`
  );
  let prevHash: string | null = null;
  for (const r of rows.rows) {
    const payload = canonical({
      decision_id: r.decision_id,
      agent_id: r.agent_id,
      human_user_id: r.human_user_id,
      event: r.event,
      actor: r.actor,
      detail: r.detail_canonical,
      prev_hash: prevHash,
    });
    const expect = crypto.createHash('sha256').update(payload).digest('hex');
    if (expect !== r.row_hash || r.prev_hash !== prevHash) {
      return { ok: false, checked: rows.rowCount ?? 0, brokenAt: Number(r.id) };
    }
    prevHash = r.row_hash;
  }
  return { ok: true, checked: rows.rowCount ?? 0 };
}

/** Full oversight record for one decision, for export to a regulator or auditor. */
export async function trailFor(decisionId: string) {
  const r = await db.query(
    `SELECT id, event, actor, human_user_id, detail, row_hash, created_at
       FROM agent.decision_events WHERE decision_id=$1 ORDER BY id ASC`,
    [decisionId]
  );
  return r.rows;
}
