import * as db from './db';

export interface ConversationMetrics {
  conversation_id: string;
  active_participants: number;
  total_messages: number;
  avg_message_length: number;
  ideas_extracted: number;
  vesting_progress_pct: number;
  days_active: number;
}

export interface IdeaMetrics {
  conversation_id: string;
  total_ideas: number;
  seedling_count: number;
  exploring_count: number;
  refined_count: number;
  mature_count: number;
  avg_confidence: number;
  top_idea_confidence: number;
}

export interface TokenomicsMetrics {
  avatar_id: string;
  current_balance: number;
  vested_tokens: number;
  locked_tokens: number;
  total_dilutions: number;
  avg_dilution_pct: number;
  days_in_conversation: number;
}

// Get conversation metrics
export async function getConversationMetrics(
  conversationId: string
): Promise<ConversationMetrics> {
  // Get basic conversation info
  const convResult = await db.query(
    `SELECT id, created_at FROM conversations WHERE id = $1`,
    [conversationId]
  );

  if (convResult.rows.length === 0) {
    throw new Error('Conversation not found');
  }

  const conversation = convResult.rows[0];
  const daysActive = Math.floor(
    (Date.now() - new Date(conversation.created_at).getTime()) / (1000 * 60 * 60 * 24)
  );

  // Get participants
  const participantsResult = await db.query(
    `SELECT COUNT(DISTINCT avatar_id) as count FROM avatar_balances WHERE conversation_id = $1`,
    [conversationId]
  );

  // Get message stats
  const messageResult = await db.query(
    `SELECT COUNT(*) as total, AVG(LENGTH(content)) as avg_len FROM messages WHERE conversation_id = $1`,
    [conversationId]
  );

  // Get ideas count
  const ideaResult = await db.query(
    `SELECT COUNT(*) as count FROM idea_repository WHERE conversation_id = $1`,
    [conversationId]
  );

  // Get vesting progress
  const vestingResult = await db.query(
    `SELECT AVG(EXTRACT(DAY FROM NOW() - created_at) / 30.0 * 100) as vesting_pct
     FROM avatar_balances WHERE conversation_id = $1`,
    [conversationId]
  );

  return {
    conversation_id: conversationId,
    active_participants: participantsResult.rows[0]?.count || 0,
    total_messages: parseInt(messageResult.rows[0]?.total || '0'),
    avg_message_length: Math.round(messageResult.rows[0]?.avg_len || 0),
    ideas_extracted: parseInt(ideaResult.rows[0]?.count || '0'),
    vesting_progress_pct: Math.min(
      100,
      Math.round((vestingResult.rows[0]?.vesting_pct || 0) * 100) / 100
    ),
    days_active: daysActive,
  };
}

// Get idea analytics
export async function getIdeaMetrics(
  conversationId: string
): Promise<IdeaMetrics> {
  // Get maturity distribution
  const maturityResult = await db.query(
    `SELECT maturity, COUNT(*) as count FROM idea_repository 
     WHERE conversation_id = $1 GROUP BY maturity`,
    [conversationId]
  );

  const maturityCounts: { [key: string]: number } = {
    seedling: 0,
    exploring: 0,
    refined: 0,
    mature: 0,
  };

  maturityResult.rows.forEach((row: any) => {
    maturityCounts[row.maturity] = parseInt(row.count);
  });

  // Get confidence stats
  const confidenceResult = await db.query(
    `SELECT COUNT(*) as total, AVG(confidence) as avg_conf, MAX(confidence) as max_conf
     FROM idea_repository WHERE conversation_id = $1`,
    [conversationId]
  );

  return {
    conversation_id: conversationId,
    total_ideas:
      parseInt(confidenceResult.rows[0]?.total || '0') || 0,
    seedling_count: maturityCounts.seedling,
    exploring_count: maturityCounts.exploring,
    refined_count: maturityCounts.refined,
    mature_count: maturityCounts.mature,
    avg_confidence:
      Math.round((parseFloat(confidenceResult.rows[0]?.avg_conf || '0') || 0) * 100) / 100,
    top_idea_confidence:
      Math.round((parseFloat(confidenceResult.rows[0]?.max_conf || '0') || 0) * 100) / 100,
  };
}

// Get tokenomics metrics for avatar
export async function getTokenomicsMetrics(
  avatarId: string,
  conversationId?: string
): Promise<TokenomicsMetrics> {
  let balanceResult;
  let daysResult;

  if (conversationId) {
    // Single conversation metrics
    balanceResult = await db.query(
      `SELECT balance FROM avatar_balances WHERE avatar_id = $1 AND conversation_id = $2`,
      [avatarId, conversationId]
    );

    daysResult = await db.query(
      `SELECT EXTRACT(DAY FROM NOW() - created_at) as days_active
       FROM conversations WHERE id = $1`,
      [conversationId]
    );
  } else {
    // Aggregate across all conversations
    balanceResult = await db.query(
      `SELECT SUM(balance) as total FROM avatar_balances WHERE avatar_id = $1`,
      [avatarId]
    );
  }

  const currentBalance = parseFloat(balanceResult.rows[0]?.balance || balanceResult.rows[0]?.total || '0');

  // Estimate vesting (simplified)
  const daysActive = daysResult?.rows[0]?.days_active || 0;
  const vestingPct = Math.min(100, (daysActive / 30) * 100);
  const vestedTokens = Math.round((currentBalance * vestingPct) / 100);
  const lockedTokens = currentBalance - vestedTokens;

  return {
    avatar_id: avatarId,
    current_balance: Math.round(currentBalance * 100) / 100,
    vested_tokens: Math.round(vestedTokens * 100) / 100,
    locked_tokens: Math.round(lockedTokens * 100) / 100,
    total_dilutions: 0,
    avg_dilution_pct: 0,
    days_in_conversation: daysActive,
  };
}

export default {
  getConversationMetrics,
  getIdeaMetrics,
  getTokenomicsMetrics,
};
