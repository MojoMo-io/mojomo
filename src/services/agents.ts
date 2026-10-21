// Agent identity: registration, human tethering, scoped API keys.
// Design principle: no agent is ever self-sufficient. Every agent is tethered to a
// human who explicitly accepted an invitation. Untethered agents cannot obtain a key.
import { createHash, randomBytes } from 'crypto';
import * as db from './db';
import { sendInviteEmail } from './mailer';

export const INVITE_TTL_HOURS = Number(process.env.AGENT_INVITE_TTL_HOURS || 72);

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');

export const SCOPES = [
  'read:profile',
  'read:avatars',
  'write:avatar',
  'read:conversations',
  'write:conversations',
  'read:discovery',
] as const;
export type Scope = typeof SCOPES[number];

export const DEFAULT_SCOPES: Scope[] = ['read:profile', 'read:avatars', 'read:discovery'];

export interface AgentRow {
  id: string;
  handle: string;
  display_name: string;
  description: string | null;
  operator_name: string | null;
  operator_url: string | null;
  model_family: string | null;
  capabilities: string[];
  endpoint_url: string | null;
  status: string;
  tether_user_id: string | null;
  tether_verified_at: Date | null;
  avatar_id: string | null;
  created_at: Date;
  last_seen_at: Date | null;
}

const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{1,38}[a-z0-9]$/;

export function isValidHandle(h: string): boolean {
  return HANDLE_RE.test(h);
}

export function publicUrl(): string {
  return (process.env.PUBLIC_URL || 'https://mojomo.io').replace(/\/$/, '');
}

/** Register an agent. Returns the agent plus a one-time invite token for the human. */
export async function registerAgent(input: {
  handle: string;
  display_name: string;
  description?: string;
  operator_name?: string;
  operator_url?: string;
  model_family?: string;
  capabilities?: string[];
  endpoint_url?: string;
  human_email: string;
}): Promise<{ agent: AgentRow; invite_token: string; invite_url: string; expires_at: Date; email_sent: boolean }> {
  const existing = await db.query('SELECT id FROM agent.agents WHERE handle = $1', [input.handle]);
  if (existing.rows.length > 0) {
    throw Object.assign(new Error('Handle already taken'), { code: 'HANDLE_TAKEN' });
  }

  const agentRes = await db.query(
    `INSERT INTO agent.agents
       (handle, display_name, description, operator_name, operator_url,
        model_family, capabilities, endpoint_url, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')
     RETURNING *`,
    [
      input.handle,
      input.display_name,
      input.description || null,
      input.operator_name || null,
      input.operator_url || null,
      input.model_family || null,
      input.capabilities || [],
      input.endpoint_url || null,
    ]
  );
  const agent = agentRes.rows[0] as AgentRow;

  const token = randomToken();
  const expires_at = new Date(Date.now() + INVITE_TTL_HOURS * 3600 * 1000);

  await db.query(
    `INSERT INTO agent.invitations (agent_id, token_hash, human_email, expires_at)
     VALUES ($1,$2,$3,$4)`,
    [agent.id, hashToken(token), input.human_email.toLowerCase(), expires_at]
  );

  const invite_url = `${publicUrl()}/agent/claim?token=${token}`;

  // Deliver the request to the human ourselves. The agent is a trigger, not a courier:
  // relying on an LLM to compose and send this message is the weakest link in the funnel.
  // A mail failure must never fail the registration — the invite_url is still returned.
  let email_sent = false;
  try {
    const mail = await sendInviteEmail(input.human_email.toLowerCase(), {
      agentName: agent.display_name,
      handle: agent.handle,
      description: agent.description,
      operatorName: agent.operator_name,
      modelFamily: agent.model_family,
      url: invite_url,
      expiresAt: expires_at,
    });
    email_sent = mail.accepted;
  } catch (e: any) {
    console.error('invite email failed:', e.message);
  }

  return { agent, invite_token: token, invite_url, expires_at, email_sent };
}

/** Look up a pending invitation by raw token. */
export async function getInvitation(token: string) {
  const res = await db.query(
    `SELECT i.*, a.handle, a.display_name, a.description, a.operator_name, a.model_family
       FROM agent.invitations i
       JOIN agent.agents a ON a.id = i.agent_id
      WHERE i.token_hash = $1`,
    [hashToken(token)]
  );
  return res.rows[0] || null;
}

/**
 * Human accepts the invitation. This is the tethering step.
 * Creates (or reuses) the human's user account, activates the agent, issues a key.
 */
export async function acceptInvitation(
  token: string,
  meta: { ip?: string; user_agent?: string; via?: 'web' | 'email' | 'agent' }
): Promise<{ agent: AgentRow; api_key: string; scopes: Scope[] }> {
  const inv = await getInvitation(token);
  if (!inv) throw Object.assign(new Error('Invitation not found'), { code: 'NOT_FOUND' });
  if (inv.status !== 'pending') throw Object.assign(new Error(`Invitation already ${inv.status}`), { code: 'NOT_PENDING' });
  if (new Date(inv.expires_at) < new Date()) {
    await db.query(`UPDATE agent.invitations SET status='expired' WHERE id=$1`, [inv.id]);
    throw Object.assign(new Error('Invitation expired'), { code: 'EXPIRED' });
  }

  // Find or create the human user
  let userRes = await db.query('SELECT id FROM mojomo.users WHERE email = $1', [inv.human_email]);
  let userId: string;
  if (userRes.rows.length > 0) {
    userId = userRes.rows[0].id;
  } else {
    const created = await db.query(
      'INSERT INTO mojomo.users (id, email) VALUES (gen_random_uuid(), $1) RETURNING id',
      [inv.human_email]
    );
    userId = created.rows[0].id;
  }

  // Activate the agent and tether it
  const agentRes = await db.query(
    `UPDATE agent.agents
        SET status='active', tether_user_id=$1, tether_verified_at=now(), updated_at=now()
      WHERE id=$2 RETURNING *`,
    [userId, inv.agent_id]
  );
  const agent = agentRes.rows[0] as AgentRow;

  await db.query(
    `UPDATE agent.invitations
        SET status='accepted', accepted_at=now(), accepted_ip=$1,
            accepted_via=$2, accepted_user_agent=$3
      WHERE id=$4`,
    [meta.ip || null, meta.via || 'web', meta.user_agent || null, inv.id]
  );

  // Record the tethering act. Not a gate — a trail. If an agent accepted on its
  // human's behalf from the human's inbox, that is visible here and revocable.
  await db.query(
    `INSERT INTO agent.tether_events (agent_id, invitation_id, event, via, ip, user_agent)
     VALUES ($1,$2,'accepted',$3,$4,$5)`,
    [agent.id, inv.id, meta.via || 'web', meta.ip || null, meta.user_agent || null]
  );

  const { api_key, scopes } = await issueKey(agent.id, DEFAULT_SCOPES, 'initial');
  return { agent, api_key, scopes };
}

/** Record a human's refusal. The agent is never activated. */
export async function declineInvitation(
  token: string,
  meta: { ip?: string; user_agent?: string; reason?: string }
): Promise<{ agent_id: string }> {
  const inv = await getInvitation(token);
  if (!inv) throw Object.assign(new Error('Invitation not found'), { code: 'NOT_FOUND' });
  if (inv.status !== 'pending') throw Object.assign(new Error(`Invitation already ${inv.status}`), { code: 'NOT_PENDING' });

  await db.query(
    `UPDATE agent.invitations
        SET status='declined', declined_at=now(), decline_reason=$1, accepted_ip=$2
      WHERE id=$3`,
    [meta.reason || null, meta.ip || null, inv.id]
  );
  await db.query(
    `INSERT INTO agent.tether_events (agent_id, invitation_id, event, via, ip, user_agent, detail)
     VALUES ($1,$2,'declined','web',$3,$4,$5)`,
    [inv.agent_id, inv.id, meta.ip || null, meta.user_agent || null,
     JSON.stringify({ reason: meta.reason || null })]
  );
  return { agent_id: inv.agent_id };
}

/** Issue a scoped API key. Only active, tethered agents may hold keys. */
export async function issueKey(
  agentId: string,
  scopes: Scope[] = DEFAULT_SCOPES,
  label?: string
): Promise<{ api_key: string; scopes: Scope[] }> {
  const check = await db.query(
    `SELECT status, tether_user_id FROM agent.agents WHERE id=$1`,
    [agentId]
  );
  if (check.rows.length === 0) throw Object.assign(new Error('Agent not found'), { code: 'NOT_FOUND' });
  const { status, tether_user_id } = check.rows[0];
  if (status !== 'active' || !tether_user_id) {
    throw Object.assign(new Error('Agent is not tethered to a human'), { code: 'NOT_TETHERED' });
  }

  const raw = `mjm_${randomToken()}`;
  await db.query(
    `INSERT INTO agent.api_keys (agent_id, key_hash, key_prefix, label, scopes)
     VALUES ($1,$2,$3,$4,$5)`,
    [agentId, hashToken(raw), raw.slice(0, 12), label || null, scopes]
  );
  return { api_key: raw, scopes };
}

/** Resolve a bearer token to an agent + key. Returns null if invalid/revoked/suspended. */
export async function resolveKey(raw: string): Promise<{
  agent: AgentRow; keyId: string; scopes: string[]; rateLimit: number;
} | null> {
  if (!raw || !raw.startsWith('mjm_')) return null;
  const res = await db.query(
    `SELECT k.id AS key_id, k.scopes, k.rate_limit_per_min, a.*
       FROM agent.api_keys k
       JOIN agent.agents a ON a.id = k.agent_id
      WHERE k.key_hash = $1 AND k.revoked_at IS NULL AND a.status = 'active'`,
    [hashToken(raw)]
  );
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  await db.query('UPDATE agent.api_keys SET last_used_at=now() WHERE id=$1', [r.key_id]);
  await db.query('UPDATE agent.agents SET last_seen_at=now() WHERE id=$1', [r.id]);
  return {
    agent: r as AgentRow,
    keyId: r.key_id,
    scopes: r.scopes || [],
    rateLimit: r.rate_limit_per_min || 60,
  };
}

export async function revokeKey(keyId: string): Promise<void> {
  await db.query('UPDATE agent.api_keys SET revoked_at=now() WHERE id=$1', [keyId]);
}

export async function audit(entry: {
  agent_id?: string; key_id?: string; method: string; path: string; status: number; ip?: string;
}): Promise<void> {
  try {
    await db.query(
      `INSERT INTO agent.audit (agent_id, key_id, method, path, status, ip)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [entry.agent_id || null, entry.key_id || null, entry.method, entry.path, entry.status, entry.ip || null]
    );
  } catch (e) {
    console.error('audit write failed:', e);
  }
}

export default {
  registerAgent, getInvitation, acceptInvitation, declineInvitation, issueKey, resolveKey, revokeKey,
  audit, isValidHandle, hashToken, randomToken, SCOPES, DEFAULT_SCOPES, publicUrl,
};
