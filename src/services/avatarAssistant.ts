// Shared orchestration for "a human said something to their own avatar" - used by both the web
// private-chat route and the Telegram webhook, so the two front-ends really are the same chat.
import * as db from './db';
import * as conversationService from './conversations';
import { generateAssistantReply } from './avatarChat';
import { queueAvatarReplyJob, queueProfileSynthesisJob } from './job-queue';
import { findMatches } from './matchmaking';
import { INTERNAL_PLACEHOLDER_TOKENS } from '../config/features';
import { Avatar } from '../types';

export interface AssistantTurnResult {
  reply: { id: string; role: string; content: string; source: string; created_at: Date };
  connection: { conversation_id: string; matched_avatar_id: string; matched_avatar_name: string; reason: string } | null;
}

export async function startMatchedConversation(userAvatarId: string, matchedAvatarId: string, topic: string) {
  const conversation = await conversationService.createConversation(
    userAvatarId,
    matchedAvatarId,
    (topic || 'A new connection').slice(0, 255),
    INTERNAL_PLACEHOLDER_TOKENS
  );
  await queueAvatarReplyJob(conversation.id, matchedAvatarId);
  return conversation;
}

/** Store a human message to `avatar`, generate its reply, act on a find_match intent if present. */
export async function handleHumanMessage(
  avatar: Avatar,
  messageText: string,
  source: 'web' | 'telegram'
): Promise<AssistantTurnResult> {
  await db.query(
    `INSERT INTO mojomo.avatar_direct_messages (avatar_id, role, content, source) VALUES ($1, 'human', $2, $3)`,
    [avatar.id, messageText, source]
  );

  const historyRes = await db.query(
    `SELECT role, content FROM mojomo.avatar_direct_messages WHERE avatar_id = $1 ORDER BY created_at ASC LIMIT 200`,
    [avatar.id]
  );

  const { visibleReply, action } = await generateAssistantReply(avatar, historyRes.rows);

  const stored = await db.query(
    `INSERT INTO mojomo.avatar_direct_messages (avatar_id, role, content, source) VALUES ($1, 'avatar', $2, $3) RETURNING id, role, content, source, created_at`,
    [avatar.id, visibleReply, source]
  );

  let connection: AssistantTurnResult['connection'] = null;
  if (action?.action === 'find_match') {
    const matches = await findMatches(avatar.id, action.query);
    if (matches.length > 0) {
      const conversation = await startMatchedConversation(avatar.id, matches[0].avatar_id, action.query || matches[0].reason);
      connection = { conversation_id: conversation.id, matched_avatar_id: matches[0].avatar_id, matched_avatar_name: matches[0].name, reason: matches[0].reason };
    }
  }

  // Refresh the personality profile every few exchanges. `historyRes` is read *before* this turn's
  // two rows are written, so a strict `% 6 === 0` check almost never lands - use a threshold on the
  // post-turn count instead, and let the queue's own guard prevent duplicates.
  const turnsSinceSynthesis = await db.query(
    `SELECT count(*)::int AS n FROM mojomo.avatar_direct_messages WHERE avatar_id = $1`,
    [avatar.id]
  );
  if (turnsSinceSynthesis.rows[0].n >= 6) {
    await queueProfileSynthesisJob(avatar.id).catch(() => undefined);
  }

  return { reply: stored.rows[0], connection };
}

export default { handleHumanMessage, startMatchedConversation };
