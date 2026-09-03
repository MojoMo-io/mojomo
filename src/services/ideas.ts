// Idea extraction and repository service
import { v4 as uuidv4 } from 'uuid';
import * as db from './db';
import { IdeaRepository, IdeaRefinement } from '../types';

const IDEA_EXTRACTION_THRESHOLD = 0.65;
const IDEA_TITLE_MAX = 255;
const IDEA_HYPOTHESIS_MAX = 10000;

/**
 * Extract hypothesis from message text
 * Looks for "IDEA:" marker or uses first 255 chars
 */
function extractHypothesis(message_text: string): string {
  // Look for IDEA: marker
  const idea_marker = message_text.indexOf('IDEA:');
  if (idea_marker !== -1) {
    const hypothesis = message_text.substring(idea_marker + 5).trim();
    return hypothesis.substring(0, IDEA_HYPOTHESIS_MAX);
  }

  // Fallback: use first 255 chars (title) + rest as hypothesis
  return message_text.substring(0, IDEA_HYPOTHESIS_MAX);
}

/**
 * Extract title from hypothesis (first line, max 255 chars)
 */
function extractTitle(hypothesis: string): string {
  const lines = hypothesis.split('\n');
  const first_line = lines[0].trim();
  return first_line.substring(0, IDEA_TITLE_MAX);
}

/**
 * Extract idea from a high-scoring message
 * Only called if idea_score > 0.65
 */
export async function extractIdeaFromMessage(
  conversation_id: string,
  message_id: string,
  avatar_id: string,
  message_text: string,
  idea_score: number
): Promise<IdeaRepository | null> {
  // Verify score threshold
  if (idea_score <= IDEA_EXTRACTION_THRESHOLD) {
    return null; // Don't extract
  }

  try {
    const hypothesis = extractHypothesis(message_text);
    const title = extractTitle(hypothesis);

    const idea_id = uuidv4();

    // Insert idea (ON CONFLICT handles duplicate prevention)
    const result = await db.query(
      `INSERT INTO mojomo.idea_repository (
        id, conversation_id, title, full_hypothesis,
        extracted_by_avatar_id, extracted_from_message_id,
        maturity_stage, confidence_score
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (extracted_from_message_id) WHERE extracted_from_message_id IS NOT NULL DO NOTHING
      RETURNING *`,
      [
        idea_id,
        conversation_id,
        title,
        hypothesis,
        avatar_id,
        message_id,
        'seedling',
        idea_score,
      ]
    );

    if (result.rows.length === 0) {
      // Idea already exists for this message
      return null;
    }

    return parseIdeaRow(result.rows[0]);
  } catch (error) {
    console.error('Error extracting idea:', error);
    throw error;
  }
}

/**
 * Get idea by ID
 */
export async function getIdea(idea_id: string): Promise<IdeaRepository> {
  const result = await db.query('SELECT * FROM mojomo.idea_repository WHERE id = $1', [
    idea_id,
  ]);

  if (result.rows.length === 0) {
    throw new Error('Idea not found');
  }

  return parseIdeaRow(result.rows[0]);
}

/**
 * List ideas from a conversation
 */
export async function listIdeas(
  conversation_id: string,
  limit: number = 50,
  offset: number = 0
): Promise<IdeaRepository[]> {
  const result = await db.query(
    `SELECT * FROM mojomo.idea_repository
     WHERE conversation_id = $1
     ORDER BY confidence_score DESC, created_at DESC
     LIMIT $2 OFFSET $3`,
    [conversation_id, limit, offset]
  );

  return result.rows.map(parseIdeaRow);
}

/**
 * List ideas by maturity stage
 */
export async function listIdeasByMaturity(
  conversation_id: string,
  maturity_stage: 'seedling' | 'exploring' | 'refined' | 'mature',
  limit: number = 50
): Promise<IdeaRepository[]> {
  const result = await db.query(
    `SELECT * FROM mojomo.idea_repository
     WHERE conversation_id = $1 AND maturity_stage = $2
     ORDER BY confidence_score DESC
     LIMIT $3`,
    [conversation_id, maturity_stage, limit]
  );

  return result.rows.map(parseIdeaRow);
}

/**
 * Update idea maturity stage
 */
export type MaturityStage = 'seedling' | 'exploring' | 'refined' | 'mature';
export const STAGE_ORDER: Record<MaturityStage, number> = { seedling: 0, exploring: 1, refined: 2, mature: 3 };

/**
 * Progression gates (spec: MOJOMO-TESTING-VALIDATION-STRATEGY "Idea Maturity Progression"), mapped onto
 * the sprint plan's stage names. Each step needs a minimum number of refinements and a confidence floor.
 */
export const MATURITY_GATES: Record<Exclude<MaturityStage, 'seedling'>, { min_refinements: number; min_confidence: number }> = {
  exploring: { min_refinements: 1, min_confidence: 0.65 },
  refined:   { min_refinements: 2, min_confidence: 0.75 },
  mature:    { min_refinements: 3, min_confidence: 0.85 },
};

export function canTransition(
  from: MaturityStage,
  to: MaturityStage,
  state: { refinement_count: number; confidence: number }
): { ok: boolean; reason?: string } {
  if (STAGE_ORDER[to] < STAGE_ORDER[from]) return { ok: false, reason: `Cannot move idea backwards from ${from} to ${to}` };
  if (STAGE_ORDER[to] === STAGE_ORDER[from]) return { ok: false, reason: `Idea is already ${to}` };
  if (STAGE_ORDER[to] !== STAGE_ORDER[from] + 1) return { ok: false, reason: `Cannot skip from ${from} to ${to}; advance one stage at a time` };
  const gate = MATURITY_GATES[to as Exclude<MaturityStage, 'seedling'>];
  if (state.refinement_count < gate.min_refinements) {
    return { ok: false, reason: `${to} requires at least ${gate.min_refinements} refinement(s); idea has ${state.refinement_count}` };
  }
  if (state.confidence < gate.min_confidence) {
    return { ok: false, reason: `${to} requires confidence >= ${gate.min_confidence}; idea has ${state.confidence.toFixed(2)}` };
  }
  return { ok: true };
}

async function assertParticipant(conversation_id: string, avatar_id: string): Promise<void> {
  const r = await db.query(
    `SELECT 1 FROM mojomo.conversations
     WHERE id = $1 AND (initiator_avatar_id = $2 OR target_avatar_id = $2 OR $2 = ANY(participant_avatar_ids))`,
    [conversation_id, avatar_id]
  );
  if (r.rows.length === 0) throw new Error('Avatar is not a participant in this conversation');
}

/** Record a refinement: optionally rewrite the hypothesis and/or restate confidence; always counts as one refinement. */
export async function refineIdea(
  idea_id: string,
  avatar_id: string,
  input: { full_hypothesis?: string; note?: string; confidence_score?: number }
): Promise<{ idea: IdeaRepository; refinement: IdeaRefinement }> {
  const idea = await getIdea(idea_id);
  if (idea.maturity_stage === 'mature') throw new Error('Idea is already mature; refinements are closed');
  await assertParticipant(idea.conversation_id, avatar_id);
  const newHypothesis = (input.full_hypothesis ?? idea.full_hypothesis).substring(0, IDEA_HYPOTHESIS_MAX);
  if (!newHypothesis.trim()) throw new Error('Hypothesis cannot be empty');
  return db.withTransaction(async (client) => {
    const ref = await client.query(
      `INSERT INTO mojomo.idea_refinements (idea_id, avatar_id, previous_hypothesis, new_hypothesis, note, confidence_score)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [idea_id, avatar_id, idea.full_hypothesis, newHypothesis, input.note ?? null, input.confidence_score ?? null]
    );
    const upd = await client.query(
      `UPDATE mojomo.idea_repository
       SET full_hypothesis = $1,
           title = CASE WHEN $2::boolean THEN $3 ELSE title END,
           confidence_score = COALESCE($4, confidence_score),
           refinement_count = refinement_count + 1,
           updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [newHypothesis, input.full_hypothesis !== undefined, extractTitle(newHypothesis), input.confidence_score ?? null, idea_id]
    );
    await client.query(
      `INSERT INTO mojomo.conversation_events (conversation_id, event_type, event_data) VALUES ($1, 'idea_refined', $2)`,
      [idea.conversation_id, JSON.stringify({ idea_id, avatar_id, refinement_id: ref.rows[0].id, confidence_score: input.confidence_score ?? null })]
    );
    const r = ref.rows[0];
    return {
      idea: parseIdeaRow(upd.rows[0]),
      refinement: { id: r.id, idea_id: r.idea_id, avatar_id: r.avatar_id, previous_hypothesis: r.previous_hypothesis, new_hypothesis: r.new_hypothesis, note: r.note ?? undefined, confidence_score: r.confidence_score != null ? parseFloat(r.confidence_score) : undefined, created_at: new Date(r.created_at) },
    };
  });
}

export async function listRefinements(idea_id: string): Promise<IdeaRefinement[]> {
  const r = await db.query('SELECT * FROM mojomo.idea_refinements WHERE idea_id = $1 ORDER BY created_at ASC', [idea_id]);
  return r.rows.map((x: any) => ({ id: x.id, idea_id: x.idea_id, avatar_id: x.avatar_id, previous_hypothesis: x.previous_hypothesis, new_hypothesis: x.new_hypothesis, note: x.note ?? undefined, confidence_score: x.confidence_score != null ? parseFloat(x.confidence_score) : undefined, created_at: new Date(x.created_at) }));
}

/**
 * Advance an idea one stage, enforcing MATURITY_GATES. Reaching 'mature' surfaces the idea:
 * surfaced_at is set and an idea_surfaced event is emitted. Idea payouts are a roadmap item (token economy).
 */
export async function updateIdeaMaturity(
  idea_id: string,
  new_maturity_stage: MaturityStage
): Promise<IdeaRepository> {
  const idea = await getIdea(idea_id);
  // numeric columns arrive from pg as strings; coerce before comparing/formatting
  const check = canTransition(idea.maturity_stage, new_maturity_stage, {
    refinement_count: Number(idea.refinement_count ?? 0),
    confidence: Number(idea.confidence_score ?? 0),
  });
  if (!check.ok) throw new Error(check.reason);
  return db.withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE mojomo.idea_repository
       SET maturity_stage = $1,
           surfaced_at = CASE WHEN $3::boolean THEN NOW() ELSE surfaced_at END,
           updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [new_maturity_stage, idea_id, new_maturity_stage === 'mature']
    );
    await client.query(
      `INSERT INTO mojomo.conversation_events (conversation_id, event_type, event_data) VALUES ($1, $2, $3)`,
      [idea.conversation_id, new_maturity_stage === 'mature' ? 'idea_surfaced' : 'idea_maturity_advanced',
       JSON.stringify({ idea_id, from: idea.maturity_stage, to: new_maturity_stage, confidence_score: idea.confidence_score, refinement_count: idea.refinement_count,
         ...(new_maturity_stage === 'mature' ? { payout: 'roadmap: token economy disabled in this build' } : {}) })]
    );
    return parseIdeaRow(result.rows[0]);
  });
}

/**
 * Get idea with related message content
 */
export async function getIdeaWithMessage(
  idea_id: string
): Promise<IdeaRepository & { message_content?: string }> {
  const idea = await getIdea(idea_id);

  if (idea.extracted_from_message_id) {
    const msg_result = await db.query(
      'SELECT message_content FROM mojomo.conversation_messages WHERE id = $1',
      [idea.extracted_from_message_id]
    );

    if (msg_result.rows.length > 0) {
      return {
        ...idea,
        message_content: msg_result.rows[0].message_content,
      };
    }
  }

  return idea;
}

/**
 * Helper: Parse database row to IdeaRepository object
 */
function parseIdeaRow(row: any): IdeaRepository {
  return {
    refinement_count: Number(row.refinement_count ?? 0),
    surfaced_at: row.surfaced_at ? new Date(row.surfaced_at) : undefined,
    id: row.id,
    conversation_id: row.conversation_id,
    title: row.title,
    full_hypothesis: row.full_hypothesis,
    extracted_by_avatar_id: row.extracted_by_avatar_id,
    extracted_from_message_id: row.extracted_from_message_id,
    maturity_stage: row.maturity_stage,
    confidence_score: row.confidence_score,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

export default {
  canTransition,
  refineIdea,
  listRefinements,
  MATURITY_GATES,
  extractIdeaFromMessage,
  getIdea,
  listIdeas,
  listIdeasByMaturity,
  updateIdeaMaturity,
  getIdeaWithMessage,
};
