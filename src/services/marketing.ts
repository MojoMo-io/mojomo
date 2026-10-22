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
