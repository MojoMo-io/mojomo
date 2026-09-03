import * as db from './db';

export interface ForfeitureStatus {
  conversation_id: string;
  avatar_id: string;
  total_tokens: number;
  vested_tokens: number;
  locked_tokens: number;
  forfeited_tokens: number;
  payout_amount: number;
}

export interface EndConversationResult {
  conversation_id: string;
  ended_at: string;
  forfeitures: ForfeitureStatus[];
}

export interface ForfeitureBreakdown {
  avatar_id: string;
  total_tokens: number;
  vested_tokens: number;
  forfeited_tokens: number;
}

// Calculate forfeiture for an avatar in a conversation
export async function calculateForfeiture(
  conversationId: string,
  avatarId: string,
  endDate: Date = new Date()
): Promise<ForfeitureStatus> {
  // Get conversation data
  const convResult = await db.query(
    'SELECT id, created_at FROM conversations WHERE id = $1',
    [conversationId]
  );

  if (convResult.rows.length === 0) {
    throw new Error('Conversation not found');
  }

  const conversation = convResult.rows[0];
  const daysActive = Math.floor(
    (endDate.getTime() - new Date(conversation.created_at).getTime()) /
      (1000 * 60 * 60 * 24)
  );

  // Get avatar balance
  const balResult = await db.query(
    `SELECT balance FROM avatar_balances 
     WHERE avatar_id = $1 AND conversation_id = $2`,
    [avatarId, conversationId]
  );

  if (balResult.rows.length === 0) {
    throw new Error('Avatar not found in conversation');
  }

  const totalTokens = balResult.rows[0].balance;

  // Calculate vested amount (linear over 30 days)
  const vestingDays = Math.min(daysActive, 30);
  const vestedTokens = (totalTokens * vestingDays) / 30;
  const lockedTokens = totalTokens - vestedTokens;
  const forfeitedTokens = lockedTokens; // All locked tokens forfeited on end

  return {
    conversation_id: conversationId,
    avatar_id: avatarId,
    total_tokens: totalTokens,
    vested_tokens: vestedTokens,
    locked_tokens: lockedTokens,
    forfeited_tokens: forfeitedTokens,
    payout_amount: vestedTokens,
  };
}

// Get forfeiture status for all avatars in a conversation
export async function getForfeitureStatus(
  conversationId: string,
  endDate: Date = new Date()
): Promise<ForfeitureStatus[]> {
  // Get all avatars in conversation
  const avatarResult = await db.query(
    `SELECT DISTINCT avatar_id FROM avatar_balances 
     WHERE conversation_id = $1`,
    [conversationId]
  );

  const statuses: ForfeitureStatus[] = [];

  for (const row of avatarResult.rows) {
    const status = await calculateForfeiture(
      conversationId,
      row.avatar_id,
      endDate
    );
    statuses.push(status);
  }

  return statuses;
}

// Calculate conversation vesting percentage and breakdown
export async function calculateConversationVesting(
  conversationId: string,
  endDate: Date = new Date()
): Promise<{ vested_pct: number; forfeiture_breakdown: ForfeitureBreakdown[] }> {
  const statuses = await getForfeitureStatus(conversationId, endDate);

  const forfeiture_breakdown: ForfeitureBreakdown[] = statuses.map((s) => ({
    avatar_id: s.avatar_id,
    total_tokens: s.total_tokens,
    vested_tokens: s.vested_tokens,
    forfeited_tokens: s.forfeited_tokens,
  }));

  // Calculate overall vesting percentage
  const totalTokens = statuses.reduce((sum, s) => sum + s.total_tokens, 0);
  const totalVested = statuses.reduce((sum, s) => sum + s.vested_tokens, 0);
  const vested_pct = totalTokens > 0 ? (totalVested / totalTokens) * 100 : 0;

  return {
    vested_pct,
    forfeiture_breakdown,
  };
}

// End a conversation and apply forfeiture
export async function endConversation(
  conversationId: string,
  avatarId: string,
  reason: string,
  endDate: Date = new Date()
): Promise<EndConversationResult> {
  const statuses = await getForfeitureStatus(conversationId, endDate);

  // Start transaction
  await db.query('BEGIN');

  try {
    for (const status of statuses) {
      // Update avatar balance to vested amount only
      await db.query(
        `UPDATE avatar_balances 
         SET balance = $1 
         WHERE avatar_id = $2 AND conversation_id = $3`,
        [status.vested_tokens, status.avatar_id, conversationId]
      );

      // Log forfeiture event
      await db.query(
        `INSERT INTO conversation_events (conversation_id, event_type, details, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [
          conversationId,
          'forfeiture',
          JSON.stringify({
            avatar_id: status.avatar_id,
            initiated_by: avatarId,
            reason,
            forfeited_amount: status.forfeited_tokens,
            payout_amount: status.payout_amount,
          }),
        ]
      );
    }

    // Mark conversation as ended
    await db.query(
      `UPDATE conversations 
       SET ended_at = $1 
       WHERE id = $2`,
      [endDate, conversationId]
    );

    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }

  return {
    conversation_id: conversationId,
    ended_at: endDate.toISOString(),
    forfeitures: statuses,
  };
}

// Check for dormant conversations and end them (90-day threshold)
export async function checkAndEndDormantConversations(): Promise<string[]> {
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  // Find conversations not yet ended, with no recent messages
  const result = await db.query(
    `SELECT c.id FROM conversations c
     LEFT JOIN messages m ON c.id = m.conversation_id 
     WHERE c.ended_at IS NULL
     AND (SELECT MAX(created_at) FROM messages WHERE conversation_id = c.id) < $1
     GROUP BY c.id`,
    [ninetyDaysAgo]
  );

  const endedConversationIds: string[] = [];

  for (const row of result.rows) {
    try {
      // Use first avatar for system-initiated end
      const avatarResult = await db.query(
        `SELECT avatar_id FROM avatar_balances 
         WHERE conversation_id = $1 LIMIT 1`,
        [row.id]
      );

      if (avatarResult.rows.length > 0) {
        await endConversation(row.id, avatarResult.rows[0].avatar_id, 'auto_end_dormant');
        endedConversationIds.push(row.id);
      }
    } catch (error) {
      console.error(`Failed to auto-end conversation ${row.id}:`, error);
    }
  }

  return endedConversationIds;
}

export default {
  calculateForfeiture,
  getForfeitureStatus,
  calculateConversationVesting,
  endConversation,
  checkAndEndDormantConversations,
};
