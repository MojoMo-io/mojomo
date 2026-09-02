// Idea extraction and repository service
import { v4 as uuidv4 } from 'uuid';
import * as db from './db';
import { IdeaRepository } from '../types';

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
      ON CONFLICT (extracted_from_message_id) DO NOTHING
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
export async function updateIdeaMaturity(
  idea_id: string,
  new_maturity_stage: 'seedling' | 'exploring' | 'refined' | 'mature'
): Promise<IdeaRepository> {
  // Validate stage progression
  const idea = await getIdea(idea_id);

  const stage_order = {
    seedling: 0,
    exploring: 1,
    refined: 2,
    mature: 3,
  };

  if (stage_order[new_maturity_stage] < stage_order[idea.maturity_stage]) {
    throw new Error(
      `Cannot move idea backwards from ${idea.maturity_stage} to ${new_maturity_stage}`
    );
  }

  const result = await db.query(
    `UPDATE mojomo.idea_repository
     SET maturity_stage = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [new_maturity_stage, idea_id]
  );

  return parseIdeaRow(result.rows[0]);
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
  extractIdeaFromMessage,
  getIdea,
  listIdeas,
  listIdeasByMaturity,
  updateIdeaMaturity,
  getIdeaWithMessage,
};
