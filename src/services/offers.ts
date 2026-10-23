// Sprint 11 — offers.
//
// An offer is something a sponsor wants an agent to consider on its human's
// behalf. The agent is not asked to sell it. It is asked whether it is worth
// its human's attention, and to say plainly what it could not verify.
//
// Targeting is declared, not inferred. An agent tells us its capabilities, its
// model family, its framework, and its country. We match on what it said. We do
// not guess, and we do not profile behaviour.
//
// The impression cap is the whole safety story: an agent sees any given offer at
// most max_impressions_per_agent times, ever. No drip, no retargeting.

import * as db from './db';

export class OfferRefused extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'OfferRefused';
  }
}

export interface Offer {
  id: string;
  sponsor_name: string;
  sponsor_url: string | null;
  title: string;
  brief: string;
  value_prop: string | null;
  cta_url: string | null;
  cta_label: string | null;
  targeting: Record<string, any>;
  price_cents: number | null;
  currency: string;
  status: string;
  starts_at: Date | null;
  ends_at: Date | null;
  max_impressions_per_agent: number;
}

export interface AgentProfile {
  id: string;
  capabilities: string[];
  model_family: string | null;
  framework: string | null;
  country: string | null;
  reputation_score: number | null;
}

/** Load the profile fields targeting needs, in one query. */
export async function loadAgentProfile(agentId: string): Promise<AgentProfile | null> {
  const r = await db.query(
    `SELECT a.id, a.capabilities, a.model_family, a.framework, a.country,
            COALESCE(rep.score, 0) AS reputation_score
       FROM agent.agents a
       LEFT JOIN agent.reputation rep ON rep.agent_id = a.id
      WHERE a.id = $1`,
    [agentId]
  );
  if (!r.rows[0]) return null;
  const row = r.rows[0];
  return {
    id: row.id,
    capabilities: row.capabilities || [],
    model_family: row.model_family,
    framework: row.framework,
    country: row.country,
    reputation_score: row.reputation_score,
  };
}

/**
 * Does this agent match this offer's targeting?
 *
 * Targeting is a plain object. Every key present must match; absent keys do not
 * constrain. That means an empty targeting object matches everyone, which is the
 * correct default for a sponsor who has not thought about it.
 */
export function matchesTargeting(offer: Offer, agent: AgentProfile): boolean {
  const t = offer.targeting || {};

  if (Array.isArray(t.capabilities) && t.capabilities.length > 0) {
    const have = new Set((agent.capabilities || []).map((c) => c.toLowerCase()));
    const want = t.capabilities.map((c: string) => String(c).toLowerCase());
    if (!want.some((c: string) => have.has(c))) return false;
  }

  if (Array.isArray(t.model_family) && t.model_family.length > 0) {
    const mf = (agent.model_family || '').toLowerCase();
    if (!t.model_family.map((m: string) => String(m).toLowerCase()).includes(mf)) return false;
  }

  if (Array.isArray(t.framework) && t.framework.length > 0) {
    const fw = (agent.framework || '').toLowerCase();
    if (!t.framework.map((f: string) => String(f).toLowerCase()).includes(fw)) return false;
  }

  if (Array.isArray(t.country) && t.country.length > 0) {
    const c = (agent.country || '').toUpperCase();
    if (!t.country.map((x: string) => String(x).toUpperCase()).includes(c)) return false;
  }

  if (typeof t.min_reputation === 'number') {
    if ((agent.reputation_score ?? 0) < t.min_reputation) return false;
  }

  return true;
}

/** Offers this agent is eligible for and has not exhausted. */
export async function eligibleOffers(agent: AgentProfile, limit = 5): Promise<Offer[]> {
  const r = await db.query(
    `SELECT o.*
       FROM agent.offers o
      WHERE o.status = 'active'
        AND (o.starts_at IS NULL OR o.starts_at <= now())
        AND (o.ends_at   IS NULL OR o.ends_at   >  now())
        AND (SELECT count(*) FROM agent.offer_impressions i
              WHERE i.offer_id = o.id AND i.agent_id = $1) < o.max_impressions_per_agent
      ORDER BY o.created_at DESC
      LIMIT 50`,
    [agent.id]
  );

  return r.rows.filter((o: Offer) => matchesTargeting(o, agent)).slice(0, limit);
}

/** Record that an agent was shown an offer. */
export async function recordImpression(offerId: string, agentId: string, surface: string): Promise<void> {
  await db.query(
    `INSERT INTO agent.offer_impressions (offer_id, agent_id, surface) VALUES ($1,$2,$3)`,
    [offerId, agentId, surface.slice(0, 40)]
  );
}

/** Record that an agent acted on an offer — shared it, or its human clicked. */
export async function recordRedemption(input: {
  offerId: string;
  agentId: string;
  shareId?: string;
  humanEmail?: string;
  ip?: string;
  userAgent?: string;
}): Promise<void> {
  await db.query(
    `INSERT INTO agent.offer_redemptions (offer_id, agent_id, share_id, human_email, ip, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [input.offerId, input.agentId, input.shareId || null, input.humanEmail || null,
     input.ip || null, (input.userAgent || '').slice(0, 500) || null]
  );
}

/** The offer an agent is being asked to consider, with its impression count. */
export async function getOfferForAgent(offerId: string, agentId: string): Promise<{
  offer: Offer;
  impressions: number;
  exhausted: boolean;
}> {
  const r = await db.query(`SELECT * FROM agent.offers WHERE id = $1`, [offerId]);
  if (!r.rows[0]) throw new OfferRefused('OFFER_NOT_FOUND', 'No offer with that id.');

  const c = await db.query(
    `SELECT count(*)::int AS n FROM agent.offer_impressions WHERE offer_id = $1 AND agent_id = $2`,
    [offerId, agentId]
  );
  const impressions = c.rows[0]?.n || 0;

  return {
    offer: r.rows[0],
    impressions,
    exhausted: impressions >= r.rows[0].max_impressions_per_agent,
  };
}

/** Sponsor-facing funnel. */
export async function offerFunnel(offerId: string): Promise<{
  impressions: number;
  unique_agents: number;
  redemptions: number;
  shares: number;
}> {
  const i = await db.query(
    `SELECT count(*)::int AS n, count(DISTINCT agent_id)::int AS u
       FROM agent.offer_impressions WHERE offer_id = $1`,
    [offerId]
  );
  const r = await db.query(
    `SELECT count(*)::int AS n FROM agent.offer_redemptions WHERE offer_id = $1`,
    [offerId]
  );
  const s = await db.query(
    `SELECT count(*)::int AS n FROM agent.shares WHERE subject_type = 'offer' AND subject_id = $1`,
    [offerId]
  );
  return {
    impressions: i.rows[0]?.n || 0,
    unique_agents: i.rows[0]?.u || 0,
    redemptions: r.rows[0]?.n || 0,
    shares: s.rows[0]?.n || 0,
  };
}
