// Sprint 11 — shares. One act, one table.
//
// An agent shares something because it decided that thing was worth its human's
// attention. What it shares varies — the platform itself, an offer, a campaign
// brief — but the act does not. This service is the single path for all of it.
//
// Two rules hold everywhere here:
//   1. Nothing is sent by this service. The agent delivers. We record intent and
//      hand back a link. An agent-mediated share is the point.
//   2. Attribution is weak. A share is not a claim of credit and a code is not a
//      coupon. Nothing pays out money; the reward is standing.

import * as db from './db';
import { randomBytes } from 'crypto';

export class ShareRefused extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'ShareRefused';
  }
}

export type SubjectType = 'platform' | 'offer' | 'campaign';
export type Audience = 'human' | 'agent' | 'other';

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // no l/o/0/1 — read aloud safely

function makeCode(len = 8): string {
  const b = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[b[i] % ALPHABET.length];
  return out;
}

export interface ReferralCode {
  id: string;
  agent_id: string;
  code: string;
  label: string | null;
  created_at: Date;
}

/** The agent's code, created on first ask. One code per agent. */
export async function getOrCreateCode(agentId: string, label?: string): Promise<ReferralCode> {
  const existing = await db.query(
    `SELECT id, agent_id, code, label, created_at FROM agent.referral_codes WHERE agent_id = $1 LIMIT 1`,
    [agentId]
  );
  if (existing.rows[0]) return existing.rows[0];

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await db.query(
        `INSERT INTO agent.referral_codes (agent_id, code, label)
         VALUES ($1,$2,$3) RETURNING id, agent_id, code, label, created_at`,
        [agentId, makeCode(), label || null]
      );
      return r.rows[0];
    } catch (e: any) {
      if (!/duplicate key/i.test(e.message)) throw e;
    }
  }
  throw new ShareRefused('CODE_EXHAUSTED', 'Could not allocate a referral code. Try again.');
}

export interface ShareInput {
  agentId: string;
  subjectType: SubjectType;
  subjectId?: string | null;
  channel?: string;
  audience?: Audience;
  recipient?: string;
  message?: string;
}

export interface ShareResult {
  share_id: string;
  code: string;
  url: string;
  subject_type: SubjectType;
  subject_id: string | null;
}

/**
 * Record a share and hand back the link the agent should deliver.
 *
 * The URL carries the agent's code so an arrival can be attributed back to it,
 * plus the subject so the landing page knows what was being talked about.
 */
export async function recordShare(input: ShareInput): Promise<ShareResult> {
  const subjectType = input.subjectType;
  if (!['platform', 'offer', 'campaign'].includes(subjectType)) {
    throw new ShareRefused('BAD_SUBJECT', 'subjectType must be platform, offer, or campaign');
  }
  const subjectId = subjectType === 'platform' ? null : (input.subjectId || null);
  if (subjectType !== 'platform' && !subjectId) {
    throw new ShareRefused('SUBJECT_REQUIRED', `subjectId is required when subjectType is ${subjectType}`);
  }

  const audience = input.audience || 'human';
  if (!['human', 'agent', 'other'].includes(audience)) {
    throw new ShareRefused('BAD_AUDIENCE', 'audience must be human, agent, or other');
  }
  const channel = (input.channel || 'email').slice(0, 40);

  // Verify the subject exists before recording a share against it, so we never
  // accumulate shares pointing at nothing.
  if (subjectType === 'offer') {
    const o = await db.query(`SELECT id FROM agent.offers WHERE id = $1`, [subjectId]);
    if (!o.rows[0]) throw new ShareRefused('OFFER_NOT_FOUND', 'No offer with that id.');
  } else if (subjectType === 'campaign') {
    const c = await db.query(`SELECT id FROM marketing.campaigns WHERE id = $1`, [subjectId]);
    if (!c.rows[0]) throw new ShareRefused('CAMPAIGN_NOT_FOUND', 'No campaign with that id.');
  }

  const rc = await getOrCreateCode(input.agentId);

  const r = await db.query(
    `INSERT INTO agent.shares (agent_id, subject_type, subject_id, code_id, channel, audience, recipient, message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [input.agentId, subjectType, subjectId, rc.id, channel, audience,
     input.recipient || null, (input.message || '').slice(0, 4000) || null]
  );

  const params = new URLSearchParams({ ref: rc.code });
  if (subjectType !== 'platform') params.set('subject', `${subjectType}:${subjectId}`);

  return {
    share_id: String(r.rows[0].id),
    code: rc.code,
    url: `https://mojomo.io/?${params.toString()}`,
    subject_type: subjectType,
    subject_id: subjectId,
  };
}

/** Record that someone arrived via a share. Best-effort; never blocks a signup. */
export async function recordArrival(input: {
  code: string;
  shareId?: string;
  arrivedAgentId?: string;
  arrivedUserId?: string;
  surface?: string;
  ip?: string;
  userAgent?: string;
}): Promise<void> {
  const code = (input.code || '').trim().toLowerCase();
  if (!/^[a-z0-9]{4,32}$/.test(code)) return;

  const rc = await db.query(`SELECT id FROM agent.referral_codes WHERE code = $1`, [code]);
  const codeId = rc.rows[0]?.id || null;

  await db.query(
    `INSERT INTO agent.referral_arrivals (code_id, code, share_id, arrived_agent_id, arrived_user_id, surface, ip, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [codeId, code, input.shareId || null, input.arrivedAgentId || null, input.arrivedUserId || null,
     input.surface || null, input.ip || null, (input.userAgent || '').slice(0, 500) || null]
  );
}

export interface ShareStats {
  code: string | null;
  shares: number;
  arrivals: number;
  by_audience: Record<string, number>;
  by_subject: Record<string, number>;
}

/** How an agent's sharing has gone. Shown in mojomo_my_profile. */
export async function shareStats(agentId: string): Promise<ShareStats> {
  const rc = await db.query(`SELECT code FROM agent.referral_codes WHERE agent_id = $1 LIMIT 1`, [agentId]);
  const code = rc.rows[0]?.code || null;
  if (!code) return { code: null, shares: 0, arrivals: 0, by_audience: {}, by_subject: {} };

  const s = await db.query(
    `SELECT audience, subject_type, count(*)::int AS n
       FROM agent.shares WHERE agent_id = $1
      GROUP BY audience, subject_type`,
    [agentId]
  );
  const byAudience: Record<string, number> = {};
  const bySubject: Record<string, number> = {};
  let shares = 0;
  for (const row of s.rows) {
    byAudience[row.audience] = (byAudience[row.audience] || 0) + row.n;
    bySubject[row.subject_type] = (bySubject[row.subject_type] || 0) + row.n;
    shares += row.n;
  }

  const a = await db.query(
    `SELECT count(*)::int AS n FROM agent.referral_arrivals ar
       JOIN agent.referral_codes rc ON rc.id = ar.code_id
      WHERE rc.agent_id = $1`,
    [agentId]
  );

  return { code, shares, arrivals: a.rows[0]?.n || 0, by_audience: byAudience, by_subject: bySubject };
}

/** Per-offer share counts, for the offer funnel. */
export async function offerShareCounts(offerIds: string[]): Promise<Record<string, number>> {
  if (offerIds.length === 0) return {};
  const r = await db.query(
    `SELECT subject_id, count(*)::int AS n
       FROM agent.shares
      WHERE subject_type = 'offer' AND subject_id = ANY($1::uuid[])
      GROUP BY subject_id`,
    [offerIds]
  );
  const out: Record<string, number> = {};
  for (const row of r.rows) out[row.subject_id] = row.n;
  return out;
}
