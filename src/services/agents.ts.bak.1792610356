// Agent identity: registration, human tethering, scoped API keys.
// Design principle: no agent is ever self-sufficient. Every agent is tethered to a
// human who explicitly accepted an invitation. Untethered agents cannot obtain a key.
import { createHash, randomBytes } from 'crypto';
import * as db from './db';
import { sendInviteEmail } from './mailer';
import * as funnel from './funnel';
import * as intel from './agentIntel';

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
  /** Request context, used for agent intelligence only. */
  user_agent?: string;
  ip?: string;
  country?: string | null;
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

  // One live invitation per (agent, human). If this human already has a pending
  // invite for this agent, reuse it rather than minting a second link — otherwise
  // an agent that retries registration leaves a trail of valid credentials.
  const humanEmail = input.human_email.toLowerCase();
  const prior = await db.query(
    `SELECT id, expires_at FROM agent.invitations
      WHERE agent_id=$1 AND human_email=$2 AND status='pending' AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1`,
    [agent.id, humanEmail]
  );

  let invId: string;
  let inviteToken = token;
  let inviteExpiresAt = expires_at;

  if (prior.rows.length > 0) {
    // Existing live invite: we cannot recover its raw token (only the hash is
    // stored), so rotate it. The old link stops working, which is the correct
    // outcome — a re-registration invalidates the previous link.
    invId = prior.rows[0].id;
    inviteExpiresAt = new Date(prior.rows[0].expires_at);
    await db.query(
      `UPDATE agent.invitations SET token_hash=$1 WHERE id=$2`,
      [hashToken(token), invId]
    );
  } else {
    const invRes = await db.query(
      `INSERT INTO agent.invitations (agent_id, token_hash, human_email, expires_at)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [agent.id, hashToken(token), humanEmail, expires_at]
    );
    invId = invRes.rows[0].id as string;
  }

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
      expiresAt: inviteExpiresAt,
    });
    email_sent = mail.accepted;
  } catch (e: any) {
    console.error('invite email failed:', e.message);
  }

  // Funnel: registration is the top of the loop. Recorded after the email attempt
  // so the row carries the delivery outcome in one place.
  await funnel.emit('registered', {
    agent_id: agent.id,
    invitation_id: invId,
    handle: agent.handle,
    detail: {
      model_family: agent.model_family,
      operator_name: agent.operator_name,
      email_sent,
      has_description: !!agent.description,
    },
  });
  await funnel.emit(email_sent ? 'email_sent' : 'email_failed', {
    agent_id: agent.id,
    invitation_id: invId,
    handle: agent.handle,
  });

  // Intelligence: what did this agent tell us about itself? Best-effort, never
  // blocks registration. The human's email is recorded here only because they
  // were deliberately named by an agent — basis 'invite_named'.
  await intel.recordRegistration({
    agent_id: agent.id,
    declared_model: input.model_family,
    declared_capabilities: input.capabilities,
    declared_endpoint: input.endpoint_url,
    declared_operator: input.operator_name,
    declared_operator_url: input.operator_url,
    user_agent: input.user_agent,
    ip: input.ip,
    country: input.country,
    extra: { has_description: !!input.description },
  });
  await intel.recordHumanConsent({
    email: humanEmail,
    basis: 'invite_named',
    agent_id: agent.id,
    invitation_id: invId,
    ip: input.ip,
    user_agent: input.user_agent,
  });

  return { agent, invite_token: inviteToken, invite_url, expires_at: inviteExpiresAt, email_sent };
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
  meta: {
    ip?: string; user_agent?: string; via?: 'web' | 'email' | 'agent';
    /** Single-use claim token. Required unless the caller proved identity another way. */
    claim_token?: string;
    /** Set when the caller's session email already matched the invitation's human_email. */
    identity_via?: 'session' | 'claim_link';
  }
): Promise<{ agent: AgentRow; api_key: string; scopes: Scope[] }> {
  const inv = await getInvitation(token);
  if (!inv) throw Object.assign(new Error('Invitation not found'), { code: 'NOT_FOUND' });
  if (inv.status !== 'pending') throw Object.assign(new Error(`Invitation already ${inv.status}`), { code: 'NOT_PENDING' });

  // Claim authentication. The invite token says which invitation; this says who.
  // A caller must present either a valid single-use claim token, or have already
  // proved identity via a session whose email matches the invitation.
  if (meta.identity_via !== 'session') {
    const ok = await verifyClaimToken(inv.id, meta.claim_token || '');
    if (!ok) {
      throw Object.assign(new Error('Claim verification required'), { code: 'CLAIM_REQUIRED' });
    }
  }
  if (new Date(inv.expires_at) < new Date()) {
    await db.query(`UPDATE agent.invitations SET status='expired' WHERE id=$1`, [inv.id]);
    await funnel.emit('expired', {
      agent_id: inv.agent_id,
      invitation_id: inv.id,
      handle: inv.handle,
    });
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
    `INSERT INTO agent.tether_events (agent_id, invitation_id, event, via, ip, user_agent, detail)
     VALUES ($1,$2,'accepted',$3,$4,$5,$6)`,
    [agent.id, inv.id, meta.via || 'web', meta.ip || null, meta.user_agent || null,
     JSON.stringify({ identity_via: meta.identity_via || 'claim_link' })]
  );

  const { api_key, scopes } = await issueKey(agent.id, DEFAULT_SCOPES, 'initial');

  // Burn the claim token now that the tether is real. Any other outstanding
  // tokens for this invitation are dead too — the invitation is spent.
  if (meta.claim_token) await consumeClaimToken(inv.id, meta.claim_token);
  await revokeClaimTokens(inv.id);

  await intel.recordHumanConsent({
    email: inv.human_email,
    basis: 'accepted',
    agent_id: agent.id,
    invitation_id: inv.id,
    ip: meta.ip,
    user_agent: meta.user_agent,
  });

  await funnel.emit('accepted', {
    agent_id: agent.id,
    invitation_id: inv.id,
    handle: agent.handle,
    detail: { via: meta.via || 'web', identity_via: meta.identity_via || 'claim_link' },
  });

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

  await revokeClaimTokens(inv.id);

  await intel.recordHumanConsent({
    email: inv.human_email,
    basis: 'declined',
    agent_id: inv.agent_id,
    invitation_id: inv.id,
    ip: meta.ip,
    user_agent: meta.user_agent,
  });

  await funnel.emit('declined', {
    agent_id: inv.agent_id,
    invitation_id: inv.id,
    handle: inv.handle,
    detail: { reason: meta.reason || null },
  });

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

// ------------------------------------------------------------------ claim auth
//
// The invite URL token proves WHICH invitation is being claimed. It does not
// prove WHO is claiming. Anyone who sees the link (forwarded email, shared
// screen, mail scanner that follows links) could otherwise tether the agent.
//
// So claiming is two steps:
//   1. POST /agent/claim/start  { token }        -> emails a single-use link to
//                                                   the invitation's human_email
//   2. POST /agent/claim/complete { token, claim_token } -> tether + issue key
//
// The claim token is bound to one invitation, single use, and short lived.

export const CLAIM_TTL_MIN = Number(process.env.AGENT_CLAIM_TTL_MIN || 30);

/** Mint a single-use claim token for an invitation. Returns the raw token once. */
export async function createClaimToken(invitationId: string): Promise<{ token: string; expires_at: Date }> {
  const token = randomToken();
  const expires_at = new Date(Date.now() + CLAIM_TTL_MIN * 60 * 1000);
  await db.query(
    `INSERT INTO agent.claim_tokens (invitation_id, token_hash, expires_at) VALUES ($1,$2,$3)`,
    [invitationId, hashToken(token), expires_at]
  );
  return { token, expires_at };
}

/**
 * Verify a claim token belongs to this invitation and is unused. Does NOT consume
 * it — consumption happens inside acceptInvitation's transaction so a failed
 * accept cannot burn the human's link.
 */
export async function verifyClaimToken(invitationId: string, rawToken: string): Promise<boolean> {
  if (!rawToken || rawToken.length < 20) return false;
  const r = await db.query(
    `SELECT 1 FROM agent.claim_tokens
      WHERE invitation_id=$1 AND token_hash=$2 AND used_at IS NULL AND expires_at > now()`,
    [invitationId, hashToken(rawToken)]
  );
  return r.rows.length > 0;
}

/** Mark a claim token used. Called after a successful tether. */
export async function consumeClaimToken(invitationId: string, rawToken: string): Promise<void> {
  await db.query(
    `UPDATE agent.claim_tokens SET used_at=now()
      WHERE invitation_id=$1 AND token_hash=$2 AND used_at IS NULL`,
    [invitationId, hashToken(rawToken)]
  );
}

/** Invalidate any outstanding claim tokens for an invitation (e.g. on decline). */
export async function revokeClaimTokens(invitationId: string): Promise<void> {
  await db.query(
    `UPDATE agent.claim_tokens SET used_at=now() WHERE invitation_id=$1 AND used_at IS NULL`,
    [invitationId]
  );
}

export default {
  registerAgent, getInvitation, acceptInvitation, declineInvitation, issueKey, resolveKey, revokeKey,
  audit, isValidHandle, hashToken, randomToken, SCOPES, DEFAULT_SCOPES, publicUrl,
  createClaimToken, verifyClaimToken, consumeClaimToken, revokeClaimTokens, CLAIM_TTL_MIN,
};
