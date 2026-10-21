// Message service with idea scoring
import { v4 as uuidv4 } from 'uuid';
import * as db from './db';
import * as conversationService from './conversations';
import { ConversationMessage } from '../types';

/**
 * Calculate idea score from message text
 * Uses simple heuristic: count keywords related to ideas/insights
 */
/** Strip control characters and hard-cap length; protects prompts built from message history. */
export function sanitizeMessageContent(content: string): string {
  return content
    .substring(0, 10000)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim();
}

export function calculateIdeaScore(message_text: string): number {
  const idea_keywords = [
    'idea',
    'hypothesis',
    'solution',
    'insight',
    'proposal',
    'concept',
    'theory',
    'approach',
    'strategy',
    'method',
    'innovative',
    'breakthrough',
    'discovery',
  ];

  const lower_text = message_text.toLowerCase();
  let score = 0;

  // Count keyword occurrences
  idea_keywords.forEach((keyword) => {
    const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
    const matches = lower_text.match(regex);
    if (matches) {
      score += matches.length * 5; // 5 points per keyword
    }
  });

  // Check for structural indicators
  if (
    lower_text.includes('would like to propose') ||
    lower_text.includes('i think') ||
    lower_text.includes('consider') ||
    lower_text.includes('what if')
  ) {
    score += 10;
  }

  // Check message length (longer messages with ideas tend to score higher)
  if (message_text.length > 200) {
    score += 5;
  }

  // Normalise to the spec's 0..1 scale (extraction threshold is 0.65)
  return Math.min(100, score) / 100;
}

/**
 * Store a message in a conversation
 */
export async function storeMessage(
  conversation_id: string,
  avatar_id: string,
  message_content: string,
  message_type: 'user_message' | 'ai_response' | 'avatar_message',
  reasoning_trace?: Record<string, any>,
  idea_score?: number
): Promise<ConversationMessage> {
  message_content = sanitizeMessageContent(message_content);
  if (!message_content) throw new Error('Message content is empty after sanitization');
  // Verify conversation exists
  const conversation = await conversationService.getConversation(conversation_id);
  if (conversation.status === 'ended') {
    throw new Error('Conversation has ended');
  }

  // Verify avatar is participant
  const is_participant =
    avatar_id === conversation.initiator_avatar_id ||
    avatar_id === conversation.target_avatar_id ||
    conversation.participant_avatar_ids.includes(avatar_id);

  if (!is_participant) {
    throw new Error('Avatar is not a participant in this conversation');
  }

  const message_id = uuidv4();

  // Calculate idea score if not provided
  const final_idea_score = idea_score ?? (message_type === 'ai_response' ? calculateIdeaScore(message_content) : null);

  return db.withTransaction(async (client) => {
    // Create message
    const result = await client.query(
      `INSERT INTO mojomo.conversation_messages (
        id, conversation_id, avatar_id, message_content, message_type,
        reasoning_trace, idea_score, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING *`,
      [
        message_id,
        conversation_id,
        avatar_id,
        message_content,
        message_type,
        reasoning_trace ? JSON.stringify(reasoning_trace) : null,
        final_idea_score,
      ]
    );

    // Update conversation's last_message_at
    await client.query(
      `UPDATE mojomo.conversations
       SET last_message_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [conversation_id]
    );

    // Log message event
    await client.query(
      `INSERT INTO mojomo.conversation_events (
        conversation_id, event_type, event_data
      ) VALUES ($1, $2, $3)`,
      [
        conversation_id,
        'message_added',
        JSON.stringify({
          avatar_id,
          message_type,
          idea_score: final_idea_score,
          message_length: message_content.length,
        }),
      ]
    );

    const row = result.rows[0];
    return parseMessageRow(row);
  });
}

/**
 * Get a message by ID
 */
export async function getMessage(message_id: string): Promise<ConversationMessage> {
  const result = await db.query(
    'SELECT * FROM mojomo.conversation_messages WHERE id = $1',
    [message_id]
  );

  if (result.rows.length === 0) {
    throw new Error('Message not found');
  }

  return parseMessageRow(result.rows[0]);
}

/**
 * List messages in a conversation with pagination
 */
export async function listConversationMessages(
  conversation_id: string,
  limit: number = 50,
  offset: number = 0
): Promise<ConversationMessage[]> {
  const result = await db.query(
    `SELECT * FROM mojomo.conversation_messages
     WHERE conversation_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [conversation_id, limit, offset]
  );

  return result.rows.map(parseMessageRow);
}

/**
 * Get high-scoring idea messages (idea_score > threshold)
 */
export async function getIdeaMessages(
  conversation_id: string,
  min_idea_score: number = 65,
  limit: number = 20
): Promise<ConversationMessage[]> {
  const result = await db.query(
    `SELECT * FROM mojomo.conversation_messages
     WHERE conversation_id = $1
       AND message_type = 'ai_response'
       AND idea_score >= $2
     ORDER BY idea_score DESC, created_at DESC
     LIMIT $3`,
    [conversation_id, min_idea_score, limit]
  );

  return result.rows.map(parseMessageRow);
}

/**
 * Helper: Parse database row to ConversationMessage
 */
function parseMessageRow(row: any): ConversationMessage {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    avatar_id: row.avatar_id,
    message_content: row.message_content,
    message_type: row.message_type,
    reasoning_trace:
      typeof row.reasoning_trace === 'string'
        ? JSON.parse(row.reasoning_trace)
        : row.reasoning_trace,
    idea_score: row.idea_score,
    created_at: new Date(row.created_at),
  };
}

export default {
  storeMessage,
  getMessage,
  listConversationMessages,
  getIdeaMessages,
  calculateIdeaScore,
  sanitizeMessageContent,
};
