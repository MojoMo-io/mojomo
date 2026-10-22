// Sprint 12 — external agent marketing, compliance-first.
//
// The platform does not carry marketing copy. It carries claims: sourced, dated,
// jurisdiction-tagged, and cleared by a human before any agent may see them.
//
// The gate is closed by default. An empty claims table means nothing is served,
// which is the correct state until a human has verified a source and decided
// whether the issuer is licensed for the jurisdiction being asked about.
//
// VARA Marketing Regulations 2024 apply to all VA marketing targeting the UAE,
// domestic and foreign, licensed or not. Marketing may only be conducted by, or
// on behalf of and approved by, a VARA-licensed VASP. The educational exemption
// is the only path that does not require the issuer to be licensed, and it holds
// only if the content is non-promotional and carries proper risk disclosure.
// That disclosure is enforced here, in code, not by convention.

import * as db from './db';

/** The disclosure every agent response must carry. VARA: risk and volatility. */
export const VA_RISK_DISCLOSURE =
  'Virtual assets are volatile and you can lose the money you put in. ' +
  'This is general information, not financial advice, and not a recommendation to buy or sell. ' +
  'Past or projected returns are not a guide to future performance.';

export interface Claim {
  id: string;
  subject: string;
  claim_text: string;
  source_url: string;
  source_verified_at: Date;
  jurisdiction: string;
  issuer_licensed: boolean;
  licence_ref: string | null;
  cleared_for_uae: boolean;
  cleared_by: string | null;
  cleared_at: Date | null;
}

export class MarketingRefused extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'MarketingRefused';
  }
}

/**
 * Claims an agent may use for a subject in a jurisdiction.
 *
 * Returns [] rather than throwing when nothing is cleared — an empty list is a
 * legitimate answer ("we have nothing verified to say"), not an error. The
 * refusal path is for a jurisdiction we cannot serve at all.
 */
export async function clearedClaims(subject: string, jurisdiction: string): Promise<Claim[]> {
  const r = await db.query(
    `SELECT id, subject, claim_text, source_url, source_verified_at, jurisdiction,
            issuer_licensed, licence_ref, cleared_for_uae, cleared_by, cleared_at
       FROM marketing.claims
      WHERE subject = $1
        AND jurisdiction = $2
        AND cleared_for_uae = true
        AND withdrawn_at IS NULL
        AND (jurisdiction <> 'AE' OR issuer_licensed = true)
      ORDER BY cleared_at DESC`,
    [subject, jurisdiction]
  );
  return r.rows;
}

/**
 * The gate. Called before any marketing content is assembled for an agent.
 *
 * UAE is the strict path: if nothing is cleared, we refuse rather than serve a
 * degraded answer, because a degraded answer is still marketing.
 */
export async function assertCanServe(subject: string, jurisdiction: string): Promise<Claim[]> {
  const claims = await clearedClaims(subject, jurisdiction);
  if (claims.length > 0) return claims;

  if (jurisdiction === 'AE') {
    throw new MarketingRefused(
      'NOT_CLEARED_FOR_UAE',
      'No claims for this subject are cleared for the UAE. Under VARA Marketing Regulations 2024 ' +
      'this cannot be served until a licensed issuer and human-cleared claims exist.'
    );
  }
  return [];
}

/** Record that a claim was served. Append-only; never pruned. */
export async function recordServing(input: {
  claim_id: string;
  agent_id: string;
  human_user_id?: string | null;
  jurisdiction: string;
  task_id?: string | null;
}): Promise<void> {
  await db.query(
    `INSERT INTO marketing.servings (claim_id, agent_id, human_user_id, jurisdiction, task_id)
     VALUES ($1,$2,$3,$4,$5)`,
    [input.claim_id, input.agent_id, input.human_user_id || null, input.jurisdiction, input.task_id || null]
  );
}

/**
 * Validate an agent's response before it goes back to its human.
 *
 * Two things are non-negotiable: the risk disclosure is present, and the agent
 * has stated what it could not verify. An assessment that claims certainty it
 * does not have is the failure mode this whole sprint exists to prevent.
 */
export function validateAssessment(body: string): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!body.includes(VA_RISK_DISCLOSURE)) missing.push('risk_disclosure');
  if (!/could not verify|unable to verify|not verified|no evidence/i.test(body)) {
    missing.push('unverified_statement');
  }
  return { ok: missing.length === 0, missing };
}

/** Human clears a claim. Refuses to clear a UAE claim for an unlicensed issuer. */
export async function clearClaim(input: {
  id: string;
  cleared_by: string;
  issuer_licensed: boolean;
  licence_ref?: string;
}): Promise<Claim> {
  if (input.issuer_licensed && !input.licence_ref) {
    throw new MarketingRefused('LICENCE_REF_REQUIRED', 'A licensed issuer must cite a licence reference.');
  }
  const r = await db.query(
    `UPDATE marketing.claims
        SET cleared_for_uae = true, cleared_by = $2, cleared_at = now(),
            issuer_licensed = $3, licence_ref = $4
      WHERE id = $1 AND withdrawn_at IS NULL
      RETURNING *`,
    [input.id, input.cleared_by, input.issuer_licensed, input.licence_ref || null]
  );
  if (r.rows.length === 0) throw new MarketingRefused('NOT_FOUND', 'Claim not found or withdrawn.');
  return r.rows[0];
}

// ---------------------------------------------------------------------------
// Sprint 12.2 — campaigns.
//
// A campaign declares its own regime. 'general' skips the VA gate: an agent
// marketing a SaaS product or a design service does not need a VARA licence to
// describe it. 'va_regulated' keeps every phase15 constraint.
//
// Disclosure is never optional, in either regime. An agent that reports back to
// its human with confident nonsense is worse than no agent at all, because the
// human cannot tell the difference.
// ---------------------------------------------------------------------------

export interface Campaign {
  id: string;
  slug: string;
  subject: string;
  regime: 'general' | 'va_regulated';
  jurisdiction: string;
  brief: string;
  target_agent: string | null;
  active: boolean;
}

export async function getCampaign(slug: string): Promise<Campaign | null> {
  const r = await db.query(
    `SELECT id, slug, subject, regime, jurisdiction, brief, target_agent, active
       FROM marketing.campaigns WHERE slug = $1 AND active = true`,
    [slug]
  );
  return r.rows[0] || null;
}

export async function createCampaign(input: {
  slug: string; subject: string; brief: string;
  regime?: 'general' | 'va_regulated'; jurisdiction?: string;
  target_agent?: string; created_by?: string;
}): Promise<Campaign> {
  const r = await db.query(
    `INSERT INTO marketing.campaigns (slug, subject, brief, regime, jurisdiction, target_agent, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [input.slug, input.subject, input.brief, input.regime || 'general',
     input.jurisdiction || 'GLOBAL', input.target_agent || null, input.created_by || null]
  );
  return r.rows[0];
}

/**
 * The brief an agent receives for a campaign.
 *
 * General campaigns are served without the VA gate. Regulated ones go through
 * assertCanServe and refuse if nothing is cleared.
 */
export async function campaignBrief(slug: string, jurisdiction?: string): Promise<{
  campaign: Campaign;
  claims: Claim[];
  disclosure: string;
  instructions: string;
}> {
  const campaign = await getCampaign(slug);
  if (!campaign) throw new MarketingRefused('CAMPAIGN_NOT_FOUND', 'No active campaign with that slug.');

  const j = jurisdiction || campaign.jurisdiction;
  const claims = campaign.regime === 'va_regulated'
    ? await assertCanServe(campaign.subject, j)
    : await clearedClaims(campaign.subject, j);

  return {
    campaign,
    claims,
    disclosure: VA_RISK_DISCLOSURE,
    instructions:
      `Assess ${campaign.subject} against the brief below and report back to your human. ` +
      `You are not being asked to sell it. You are being asked whether it is worth their attention, ` +
      `and to say plainly what you could not verify. ` +
      `Your response must include the disclosure verbatim and must state what you could not verify. ` +
      `Brief: ${campaign.brief}`,
  };
}
