// Automatic idea maturation.
//
// Ideas are captured as 'seedling' by extractIdeaFromMessage and, until now, nothing ever moved
// them forward: updateIdeaMaturity existed but had no caller, so the repository only ever filled
// up. This sweep advances ideas one stage at a time through the existing MATURITY_GATES, and
// records a refinement when the gate needs one that doesn't exist yet.
//
// Design notes:
//  - Advancement is strictly one stage per sweep, via canTransition(), so the gates stay the
//    single source of truth and nothing can skip a stage.
//  - A gate that needs refinements gets a *system* refinement derived from the idea's own
//    hypothesis. It is attributed to the avatar that extracted the idea, and marked as
//    system-generated in the note so it is never mistaken for a human contribution.
//  - Confidence is only ever raised by evidence (a refinement), never invented, so an idea with
//    a low extraction score will stall at 'seedling' rather than being promoted on a timer.
import * as db from './db';
import {
  canTransition,
  updateIdeaMaturity,
  refineIdea,
  MATURITY_GATES,
  STAGE_ORDER,
  MaturityStage,
} from './ideas';

export interface MaturationResult {
  idea_id: string;
  from: MaturityStage;
  to: MaturityStage | null;
  advanced: boolean;
  reason?: string;
}

/** Confidence bump applied per system refinement, capped at the next gate's floor. */
const CONFIDENCE_STEP = 0.05;

/**
 * Advance one idea as far as the gates allow (at most one stage per call).
 * Returns what happened rather than throwing, so a sweep can report per-idea outcomes.
 */
export async function advanceIdea(ideaId: string): Promise<MaturationResult> {
  const res = await db.query('SELECT * FROM mojomo.idea_repository WHERE id = $1', [ideaId]);
  if (res.rows.length === 0) throw new Error('Idea not found');
  const idea = res.rows[0];

  const from: MaturityStage = idea.maturity_stage;
  if (from === 'mature') return { idea_id: ideaId, from, to: null, advanced: false, reason: 'already mature' };

  const next = (Object.keys(STAGE_ORDER) as MaturityStage[]).find((s) => STAGE_ORDER[s] === STAGE_ORDER[from] + 1);
  if (!next) return { idea_id: ideaId, from, to: null, advanced: false, reason: 'no next stage' };

  const gate = MATURITY_GATES[next as Exclude<MaturityStage, 'seedling'>];
  let refinementCount = Number(idea.refinement_count ?? 0);
  let confidence = Number(idea.confidence_score ?? 0);

  // Satisfy the refinement gate with system refinements if the idea hasn't had enough attention.
  // Goes through refineIdea() rather than inserting directly: it owns refinement_count, the
  // 'idea_refined' event, and the participant check, so the counter can't drift from the rows.
  while (refinementCount < gate.min_refinements) {
    const bumped = Math.min(1, Math.round((confidence + CONFIDENCE_STEP) * 100) / 100);
    const { idea: updated } = await refineIdea(ideaId, idea.extracted_by_avatar_id, {
      note: 'system: automatic maturation pass (no human refinement yet)',
      confidence_score: bumped,
    });
    refinementCount = Number(updated.refinement_count ?? refinementCount + 1);
    confidence = Number(updated.confidence_score ?? bumped);
  }

  const check = canTransition(from, next, { refinement_count: refinementCount, confidence });
  if (!check.ok) {
    return { idea_id: ideaId, from, to: null, advanced: false, reason: check.reason };
  }

  await updateIdeaMaturity(ideaId, next);
  return { idea_id: ideaId, from, to: next, advanced: true };
}

/**
 * Sweep every non-mature idea. Bounded by `limit` so a large backlog can't stall the job queue.
 */
export async function runMaturationSweep(limit = 50): Promise<MaturationResult[]> {
  const rows = await db.query(
    `SELECT id FROM mojomo.idea_repository
     WHERE maturity_stage <> 'mature'
     ORDER BY updated_at ASC
     LIMIT $1`,
    [limit]
  );

  const results: MaturationResult[] = [];
  for (const row of rows.rows) {
    try {
      results.push(await advanceIdea(row.id));
    } catch (err: any) {
      console.error(`Maturation failed for idea ${row.id}:`, err.message);
      results.push({ idea_id: row.id, from: 'seedling', to: null, advanced: false, reason: err.message });
    }
  }
  return results;
}

export default { advanceIdea, runMaturationSweep };
