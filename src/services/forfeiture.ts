// Forfeiture and conversation ending service
import { v4 as uuidv4 } from 'uuid';
import * as db from './db';
import * as conversationService from './conversations';
import { OwnershipLedger } from '../types';

/**
 * Calculate vested percentage for all avatars in a conversation
 */
export async function calculateConversationVesting(
  conversation_id: string,
  timestamp: Date = new Date()
): Promise<{
  vested_pct: number;
  forfeiture_breakdown: Array<{
    avatar_id: string;
    total_tokens: number;
    vested_tokens: number;
    forfeited_tokens: number;
  }>;
}> {
  const conversation = await conversationService.getConversation(conversation_id);

  // Calculate vesting for all avatars
  const vesting_start = conversation.created_at;
  const vesting_end = new Date(vesting_start.getTime() + 30 * 24 * 60 * 60 * 1000);

  let vested_pct = 0;
  if (timestamp >= vesting_end) {
    vested_pct = 100;
  } else if (timestamp > vesting_start) {
    const elapsed_ms = timestamp.getTime() - vesting_start.getTime();
    const total_ms = vesting_end.getTime() - vesting_start.getTime();
    vested_pct = Math.round((elapsed_ms / total_ms) * 10000) / 100;
  }

  // Calculate breakdown per avatar
  const forfeiture_breakdown = Object.entries(conversation.ownership_ledger).map(
    ([avatar_id, entry]: [string, any]) => ({
      avatar_id,
      total_tokens: entry.token_balance,
      vested_tokens: Math.round((entry.token_balance * vested_pct) / 100 * 100) / 100,
      forfeited_tokens: entry.token_balance - Math.round((entry.token_balance * vested_pct) / 100 * 100) / 100,
    })
  );

  return {
    vested_pct,
    forfeiture_breakdown,
  };
}

/**
 * End a conversation with forfeiture logic
 */
export async function endConversation(
  conversation_id: string,
  avatar_id: string,
  reason: 'ended_by_initiator' | 'ended_by_target' | 'dormant_90_days'
): Promise<{
  status: string;
  vested_pct: number;
  forfeited_tokens: number;
  forfeiture_data?: Record<string, any>;
}> {
  return db.withTransaction(async (client) => {
    // Verify conversation exists
    const conversation = await conversationService.getConversation(conversation_id);
    if (conversation.status === 'ended') {
      throw new Error('Conversation has ended');
    }

    // Verify authorization (only initiator/target can end, or dormancy)
    if (reason !== 'dormant_90_days') {
      if (
        avatar_id !== conversation.initiator_avatar_id &&
        avatar_id !== conversation.target_avatar_id
      ) {
        throw new Error('Only initiator or target can end conversation');
      }
    }

    // Calculate current vesting
    const { vested_pct, forfeiture_breakdown } =
      await calculateConversationVesting(conversation_id);

    // Calculate total forfeited
    const total_forfeited = forfeiture_breakdown.reduce((sum, entry) => sum + entry.forfeited_tokens, 0);

    // Create forfeiture event if tokens are locked
    if (vested_pct < 100) {
      const forfeiture_data = {
        reason,
        vested_pct,
        forfeiture_breakdown,
        ended_at: new Date().toISOString(),
      };

      // Log forfeiture event
      await client.query(
        `INSERT INTO mojomo.conversation_events (
          conversation_id, event_type, event_data
        ) VALUES ($1, $2, $3)`,
        [
          conversation_id,
          'conversation_ended_with_forfeiture',
          JSON.stringify(forfeiture_data),
        ]
      );

      // Log to token_ledger for each avatar
      for (const entry of forfeiture_breakdown) {
        await client.query(
          `INSERT INTO mojomo.token_ledger (
            conversation_id, avatar_id, event_type,
            event_data
          ) VALUES ($1, $2, $3, $4)`,
          [
            conversation_id,
            entry.avatar_id,
            'forfeiture',
            JSON.stringify({
              reason,
              total_tokens: entry.total_tokens,
              vested_tokens: entry.vested_tokens,
              forfeited_tokens: entry.forfeited_tokens,
              vested_pct,
            }),
          ]
        );
      }
    } else {
      // No forfeiture, just log the event
      await client.query(
        `INSERT INTO mojomo.conversation_events (
          conversation_id, event_type, event_data
        ) VALUES ($1, $2, $3)`,
        [
          conversation_id,
          'conversation_ended',
          JSON.stringify({
            reason,
            vested_pct: 100,
            ended_at: new Date().toISOString(),
          }),
        ]
      );
    }

    // Update conversation status
    await client.query(
      `UPDATE mojomo.conversations
       SET status = $1, ended_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      ['ended', conversation_id]
    );

    return {
      status: 'ended',
      vested_pct,
      forfeited_tokens: total_forfeited,
    };
  });
}

/**
 * Check for dormant conversations and end them
 * Should be run as a scheduled job (daily)
 */
export async function checkAndEndDormantConversations(
  inactivity_days: number = 90
): Promise<{
  ended_count: number;
  forfeited_count: number;
}> {
  const inactivity_ms = inactivity_days * 24 * 60 * 60 * 1000;
  const cutoff_time = new Date(Date.now() - inactivity_ms);

  // Find dormant conversations
  const result = await db.query(
    `SELECT id FROM mojomo.conversations
     WHERE status = 'active'
       AND (last_message_at IS NULL OR last_message_at < $1)
       AND created_at < $1
     LIMIT 1000`,
    [cutoff_time]
  );

  let ended_count = 0;
  let forfeited_count = 0;

  // End each dormant conversation
  for (const { id } of result.rows) {
    try {
      const result_end = await endConversation(id, '', 'dormant_90_days');

      ended_count++;
      if (result_end.forfeited_tokens > 0) {
        forfeited_count++;
      }
    } catch (error) {
      console.error(`Error ending dormant conversation ${id}:`, error);
    }
  }

  return {
    ended_count,
    forfeited_count,
  };
}

let dormantTimer: ReturnType<typeof setInterval> | null = null;
let dormantKickoff: ReturnType<typeof setTimeout> | null = null;

/** Periodically end conversations with no activity for `inactivityDays` (spec: 90-day dormancy). */
export function startDormantScheduler(
  intervalMs: number = Number(process.env.DORMANT_CHECK_INTERVAL_MS || 6 * 60 * 60 * 1000),
  inactivityDays: number = Number(process.env.DORMANT_INACTIVITY_DAYS || 90),
  firstRunDelayMs: number = 60 * 1000
): void {
  if (dormantTimer) return;
  const run = () =>
    checkAndEndDormantConversations(inactivityDays)
      .then((r) => { if (r.ended_count > 0) console.log(`Dormancy sweep: ended ${r.ended_count} (${r.forfeited_count} with forfeiture)`); })
      .catch((e) => console.error('Dormancy sweep failed:', e));
  dormantKickoff = setTimeout(run, firstRunDelayMs);
  dormantTimer = setInterval(run, intervalMs);
  console.log(`Dormant-conversation scheduler: every ${Math.round(intervalMs / 60000)} min, inactivity ${inactivityDays} days`);
}

export function stopDormantScheduler(): void {
  if (dormantKickoff) { clearTimeout(dormantKickoff); dormantKickoff = null; }
  if (dormantTimer) { clearInterval(dormantTimer); dormantTimer = null; }
}

export default {
  startDormantScheduler,
  stopDormantScheduler,
  calculateConversationVesting,
  endConversation,
  checkAndEndDormantConversations,
};
