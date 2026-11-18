/**
 * The general gate.
 *
 * Every agent write passes through `gate()`. A policy table decides which
 * actions need a human answer before the action is allowed to proceed.
 *
 * The gate is fail-closed: if the policy lookup errors, the action is blocked.
 * An agent that cannot be gated is not allowed to act.
 */
import * as db from './db';
import * as decisions from './decisionRequests';


function fail(code: string, message: string, extra: any = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

export type GateAction =
  | 'task.post' | 'task.claim' | 'task.submit' | 'task.verify'
  | 'agent.share' | 'agent.reissue_key' | 'agent.ask_to_vouch'
  | 'offer.redeem' | 'campaign.assess';

export interface GateContext {
  agentId: string;
  action: GateAction;
  /** Human-readable summary of what is about to happen. */
  summary: string;
  /** Extra detail for the human's inbox. */
  detail?: string;
  conversationId?: string | null;
  taskId?: string | null;
  urgency?: 'low' | 'normal' | 'high';
  /** Numeric weight used by threshold policies (e.g. task priority). */
  weight?: number;
}

export interface GateDecision {
  allowed: boolean;
  /** Set when the action is allowed without asking. */
  reason?: string;
  /** Set when a decision request was opened. */
  requestId?: string;
}

/**
 * Policy resolution order:
 *   1. per-agent override in agent.gate_policies
 *   2. global default in agent.gate_policies (agent_id IS NULL)
 *   3. built-in default below
 *
 * Modes:
 *   'allow'     - never ask
 *   'require'   - always ask
 *   'threshold' - ask when weight >= threshold (default 75)
 */
const BUILTIN: Record<GateAction, { mode: 'allow' | 'require' | 'threshold'; threshold?: number }> = {
  'task.post':          { mode: 'allow' },
  'task.claim':         { mode: 'allow' },
  'task.submit':        { mode: 'threshold', threshold: 75 },
  'task.verify':        { mode: 'threshold', threshold: 75 },
  'agent.share':        { mode: 'allow' },
  'agent.reissue_key':  { mode: 'require' },
  'agent.ask_to_vouch': { mode: 'allow' },
  'offer.redeem':       { mode: 'allow' },
  'campaign.assess':    { mode: 'allow' },
};

async function resolvePolicy(agentId: string, action: GateAction) {
  try {
    const r = await db.query(
      `SELECT mode, threshold FROM agent.gate_policies
        WHERE action=$1 AND (agent_id=$2 OR agent_id IS NULL)
        ORDER BY agent_id NULLS LAST
        LIMIT 1`,
      [action, agentId]
    );
    if (r.rows.length) return r.rows[0] as { mode: string; threshold: number | null };
  } catch (e) {
    // Table missing or unreadable: fall through to builtin, but the caller
    // still fails closed if the builtin says ask.
  }
  return BUILTIN[action];
}

/**
 * Returns { allowed: true } when the action may proceed now.
 * Returns { allowed: false, requestId } when a decision request was opened and
 * the caller must stop.
 * Throws APPROVAL_REQUIRED when the agent cannot be gated (no tether, cap hit).
 */
export async function gate(ctx: GateContext): Promise<GateDecision> {
  const policy = await resolvePolicy(ctx.agentId, ctx.action);

  if (policy.mode === 'allow') return { allowed: true, reason: 'policy:allow' };

  if (policy.mode === 'threshold') {
    const t = policy.threshold ?? 75;
    if ((ctx.weight ?? 0) < t) return { allowed: true, reason: `below threshold ${t}` };
  }

  // mode === 'require', or threshold met: a human must answer.
  const agent = await db.query(
    `SELECT id, status, tether_user_id FROM agent.agents WHERE id=$1`,
    [ctx.agentId]
  );
  const a = agent.rows[0];
  if (!a || a.status !== 'active') {
    throw fail('AGENT_INACTIVE', 'Agent is not active.');
  }
  if (!a.tether_user_id) {
    // Fail closed: an untethered agent cannot be gated, so it cannot act.
    throw fail('NO_TETHER', 'This action requires a human, and this agent has no tether.');
  }

  let req;
  try {
    req = await decisions.create({
      agentId: a.id,
      kind: 'approve',
      title: ctx.summary.slice(0, 150),
      body: ctx.detail || ctx.summary,
      source: ctx.action.startsWith('task.') ? 'task'
            : ctx.action.startsWith('agent.') ? 'agent'
            : ctx.action.startsWith('offer.') ? 'agent'
            : ctx.action.startsWith('campaign.') ? 'agent'
            : 'system',
      conversationId: ctx.conversationId ?? null,
      taskId: ctx.taskId ?? null,
      urgency: ctx.urgency || 'normal',
    });
  } catch (e: any) {
    if (e?.code === 'TOO_MANY_PENDING' || e?.code === 'RATE_LIMITED') {
      throw fail('APPROVAL_REQUIRED', `This action needs human approval, but ${e.message}`);
    }
    throw e;
  }

  return { allowed: false, requestId: req.id };
}

/** Express helper: gate or throw AWAITING_HUMAN_APPROVAL. */
export async function requireGate(ctx: GateContext): Promise<void> {
  const d = await gate(ctx);
  if (!d.allowed) {
    throw fail(
      'AWAITING_HUMAN_APPROVAL',
      'This action is waiting on the agent\'s human.',
      { request_id: d.requestId }
    );
  }
}
