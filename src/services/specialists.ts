// Specialist join service with dilution model
import { PoolClient } from 'pg';
import * as crc from 'crc';
import * as conversationService from './conversations';
import { OwnershipLedger, SpecialistJoinResult } from '../types';

const DILUTION_RATE = 0.15; // 15% extracted from A+B per specialist join

/**
 * Execute specialist join with dilution model
 * - Acquires advisory lock to prevent concurrent joins
 * - Uses SERIALIZABLE isolation
 * - Re-fetches conversation to detect race conditions
 * - Extracts 15% from both A and B equally
 * - Updates ownership ledger
 * - Logs event to token_ledger
 */
export async function executeSpecialistJoinWithDilution(
  client: PoolClient,
  conversation_id: string,
  specialist_avatar_id: string
): Promise<SpecialistJoinResult> {
  // Acquire advisory lock based on conversation_id
  const lock_id = crc.crc32(conversation_id) >>> 0; // Ensure positive 32-bit int

  try {
    // Isolation level must be set before ANY other statement in the transaction (Postgres rule).
    await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    // Acquire lock (blocks until available)
    await client.query('SELECT pg_advisory_xact_lock($1)', [lock_id]);


    // Re-fetch conversation to check for concurrent modifications
    const conversationResult = await client.query(
      'SELECT * FROM mojomo.conversations WHERE id = $1 FOR UPDATE',
      [conversation_id]
    );

    if (conversationResult.rows.length === 0) {
      throw new Error('Conversation not found');
    }

    const conversation_row = conversationResult.rows[0];
    const current_ownership = (typeof conversation_row.ownership_ledger === 'string' ? JSON.parse(conversation_row.ownership_ledger) : conversation_row.ownership_ledger);
    const participant_avatar_ids = conversation_row.participant_avatar_ids || [];

    // Check if specialist already in conversation
    if (current_ownership[specialist_avatar_id]) {
      throw new Error('Specialist already in conversation');
    }

    // Get initiator and target (the two core participants at join_round 0)
    const initiator_id = conversation_row.initiator_avatar_id;
    const target_id = conversation_row.target_avatar_id;

    const initiator_data = current_ownership[initiator_id];
    const target_data = current_ownership[target_id];

    if (!initiator_data || !target_data) {
      throw new Error('Initiator or target not found in ownership ledger');
    }

    // Calculate current specialist count (join_round > 0)
    const current_specialist_count = Object.values(current_ownership)
      .filter((o: any) => (o.join_round || 0) > 0).length;

    const join_round = current_specialist_count + 1;

    // Calculate extraction amounts (15% from each)
    const initiator_extracted = initiator_data.ownership_pct * DILUTION_RATE;
    const target_extracted = target_data.ownership_pct * DILUTION_RATE;
    const total_extracted = initiator_extracted + target_extracted;

    // Calculate new ownership percentages
    const initiator_new_pct = initiator_data.ownership_pct - initiator_extracted;
    const target_new_pct = target_data.ownership_pct - target_extracted;
    const specialist_pct = total_extracted;

    // Verify math (ownership must sum to 100%)
    let total_pct = initiator_new_pct + target_new_pct + specialist_pct;

    // Add other specialists' ownership (unchanged)
    for (const [avatar_id, data] of Object.entries(current_ownership)) {
      if (avatar_id !== initiator_id && avatar_id !== target_id) {
        total_pct += (data as any).ownership_pct;
      }
    }

    if (Math.abs(total_pct - 100) > 0.1) {
      throw new Error(
        `Ownership sum validation failed: ${total_pct.toFixed(2)}% (expected 100%)`
      );
    }

    // Calculate tokens
    const total_tokens = parseFloat(conversation_row.total_tokens);
    const initiator_tokens = (initiator_new_pct / 100) * total_tokens;
    const target_tokens = (target_new_pct / 100) * total_tokens;
    const specialist_tokens = (specialist_pct / 100) * total_tokens;

    // Build updated ownership ledger
    const updated_ownership: OwnershipLedger = {
      ...current_ownership,
      [initiator_id]: {
        ...initiator_data,
        ownership_pct: initiator_new_pct,
        token_balance: initiator_tokens,
      },
      [target_id]: {
        ...target_data,
        ownership_pct: target_new_pct,
        token_balance: target_tokens,
      },
      [specialist_avatar_id]: {
        ownership_pct: specialist_pct,
        token_balance: specialist_tokens,
        vested_pct: 0,
        buy_in_amount: 0,
        join_round: join_round,
      },
    };

    // Update conversation with new ledger
    await client.query(
      `UPDATE mojomo.conversations
       SET ownership_ledger = $1,
           participant_avatar_ids = array_append(participant_avatar_ids, $2),
           updated_at = NOW()
       WHERE id = $3`,
      [JSON.stringify(updated_ownership), specialist_avatar_id, conversation_id]
    );

    // Log in token_ledger
    await client.query(
      `INSERT INTO mojomo.token_ledger (
        conversation_id, avatar_id, event_type,
        token_amount, previous_ownership_pct, new_ownership_pct,
        join_round
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        conversation_id,
        specialist_avatar_id,
        'join_redistribution',
        specialist_tokens,
        null,
        specialist_pct,
        join_round,
      ]
    );

    // Log specialist join event
    await client.query(
      `INSERT INTO mojomo.conversation_events (
        conversation_id, event_type, event_data
      ) VALUES ($1, $2, $3)`,
      [
        conversation_id,
        'specialist_joined',
        JSON.stringify({
          specialist_avatar_id,
          join_round,
          allocated_tokens: specialist_tokens,
          allocated_pct: specialist_pct,
        }),
      ]
    );

    return {
      specialist_avatar_id,
      allocated_tokens: specialist_tokens,
      allocated_pct: specialist_pct,
      join_round,
      new_ownership_ledger: updated_ownership,
    };
  } catch (error: any) {
    // Check for lock timeout
    if (error.code === '40P01') {
      // Serialization failure
      throw new Error('Specialist join race condition detected. Retry in a moment.');
    }
    throw error;
  }
}

/**
 * Wrapper that handles transaction management
 */
export async function joinConversationAsSpecialist(
  conversation_id: string,
  specialist_avatar_id: string
): Promise<SpecialistJoinResult> {
  const db = require('./db');

  return db.withTransaction(async (client: PoolClient) => {
    return executeSpecialistJoinWithDilution(client, conversation_id, specialist_avatar_id);
  });
}

export default {
  executeSpecialistJoinWithDilution,
  joinConversationAsSpecialist,
};
