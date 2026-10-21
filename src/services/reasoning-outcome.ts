// Persist a completed reasoning result into the conversation and extract ideas.
// Implements spec Sprint 5.1 / Phase 2: "after AI response stored with idea_score > 0.65,
// call extractIdeaFromMessage; extraction failure must not fail the message".
import * as db from './db';
import { ReasoningResponse } from './reasoning';
import { calculateIdeaScore } from './messages';
import { extractIdeaFromMessage } from './ideas';

export const IDEA_THRESHOLD = 0.65;

/** Human-readable message body for the ai_response row. Leads with the IDEA: hypothesis
 *  so extractHypothesis() in ideas.ts picks it up verbatim. */
export function composeResponseText(r: ReasoningResponse): string {
  const parts: string[] = [];
  const hyp = (r.idea_hypothesis || '').trim();
  if (hyp) parts.push(/^IDEA:/i.test(hyp) ? hyp : `IDEA: ${hyp}`);
  if (r.themes?.length) parts.push(`Themes: ${r.themes.join('; ')}`);
  if (r.insights?.length) parts.push(`Insights:\n- ${r.insights.join('\n- ')}`);
  if (r.next_steps?.length) parts.push(`Next steps:\n- ${r.next_steps.join('\n- ')}`);
  if (r.tensions?.length) parts.push(`Tensions:\n- ${r.tensions.join('\n- ')}`);
  return parts.join('\n\n') || JSON.stringify(r);
}

/** Prefer the model's own idea_score; fall back to the keyword heuristic. Always 0..1. */
export function resolveIdeaScore(r: ReasoningResponse, text: string): number {
  const raw = typeof r.idea_score === 'number' && Number.isFinite(r.idea_score)
    ? r.idea_score
    : calculateIdeaScore(text);
  return Math.round(Math.min(1, Math.max(0, raw)) * 100) / 100;
}

export interface ReasoningOutcome {
  messageId: string;
  ideaScore: number;
  ideaId: string | null;
}

export async function storeReasoningOutcome(
  conversationId: string,
  reasoningLogId: string,
  response: ReasoningResponse
): Promise<ReasoningOutcome> {
  const conv = await db.query(
    'SELECT initiator_avatar_id FROM mojomo.conversations WHERE id = $1',
    [conversationId]
  );
  if (conv.rows.length === 0) throw new Error('Conversation not found');
  // conversation_messages.avatar_id is NOT NULL; AI responses are attributed to the
  // conversation initiator, mirroring the spec's processMessageReasoning() example.
  const avatarId: string = conv.rows[0].initiator_avatar_id;

  const text = composeResponseText(response);
  const ideaScore = resolveIdeaScore(response, text);

  const msg = await db.query(
    `INSERT INTO mojomo.conversation_messages
       (conversation_id, avatar_id, message_content, message_type, reasoning_trace, idea_score)
     VALUES ($1, $2, $3, 'ai_response', $4, $5)
     RETURNING id`,
    [conversationId, avatarId, text, JSON.stringify({ reasoning_log_id: reasoningLogId, ...response }), ideaScore]
  );
  const messageId: string = msg.rows[0].id;
  await db.query(
    'UPDATE mojomo.conversations SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1',
    [conversationId]
  );

  let ideaId: string | null = null;
  if (ideaScore > IDEA_THRESHOLD) {
    try {
      const idea = await extractIdeaFromMessage(conversationId, messageId, avatarId, text, ideaScore);
      ideaId = idea ? idea.id : null;
    } catch (err: any) {
      // Spec: log and continue — the message is already stored.
      console.error(`Idea extraction failed for message ${messageId}: ${err.message}`);
    }
  }
  return { messageId, ideaScore, ideaId };
}

export default { IDEA_THRESHOLD, composeResponseText, resolveIdeaScore, storeReasoningOutcome };
