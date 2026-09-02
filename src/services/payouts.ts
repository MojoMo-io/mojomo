// Payout service with vesting validation
import { v4 as uuidv4 } from 'uuid';
import * as db from './db';
import * as conversationService from './conversations';
import { AvatarOwnershipAtTime, ValidatePayoutResult } from '../types';

/**
 * Validate a payout request
 * Checks that requested amount is within available (vested) tokens
 */
export async function validatePayoutRequest(
  avatar_id: string,
  conversation_id: string,
  requested_amount: number
): Promise<ValidatePayoutResult> {
  try {
    // Get current ownership with vesting calculation
    const ownership = await conversationService.calculateAvatarOwnershipAtTime(
      avatar_id,
      conversation_id,
      new Date()
    );

    if (requested_amount <= 0) {
      return {
        valid: false,
        error: 'Amount must be positive',
      };
    }

    if (requested_amount > ownership.available_tokens) {
      const days_remaining = Math.ceil(
        (ownership.vesting_end_date.getTime() - new Date().getTime()) / (24 * 60 * 60 * 1000)
      );
      const days_remaining_text =
        days_remaining > 0 ? `${days_remaining} days remaining` : 'vesting complete';

      return {
        valid: false,
        error: `Insufficient vested tokens. Requested: ${requested_amount}, Available: ${ownership.available_tokens.toFixed(2)}, Locked: ${ownership.locked_tokens.toFixed(2)} (${days_remaining_text})`,
      };
    }

    return { valid: true };
  } catch (error: any) {
    return {
      valid: false,
      error: error.message || 'Validation failed',
    };
  }
}

/**
 * Get vesting status for an avatar in a conversation
 */
export async function getVestingStatus(
  avatar_id: string,
  conversation_id: string
): Promise<AvatarOwnershipAtTime> {
  return conversationService.calculateAvatarOwnershipAtTime(
    avatar_id,
    conversation_id,
    new Date()
  );
}

/**
 * Initiate a payout request
 * Validates ownership, validates amount, creates payout record
 */
export async function initiatePayout(
  avatar_id: string,
  conversation_id: string,
  token_amount: number,
  payment_method?: string
): Promise<{ payout_id: string; status: string; avatar_id: string; amount: number }> {
  // Validate the payout request
  const validation = await validatePayoutRequest(avatar_id, conversation_id, token_amount);
  if (!validation.valid) {
    throw new Error(validation.error || 'Payout validation failed');
  }

  return db.withTransaction(async (client) => {
    // Re-validate within transaction to ensure no race conditions
    const ownership = await conversationService.calculateAvatarOwnershipAtTime(
      avatar_id,
      conversation_id,
      new Date()
    );

    if (token_amount > ownership.available_tokens) {
      throw new Error(
        `Race condition: available tokens changed. Was ${ownership.available_tokens}, now less. Retry.`
      );
    }

    const payout_id = uuidv4();

    // Create payout record
    await client.query(
      `INSERT INTO mojomo.payouts (
        id, conversation_id, avatar_id, token_amount, payment_method, status
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [payout_id, conversation_id, avatar_id, token_amount, payment_method || null, 'pending']
    );

    // Update avatar's token balance in conversation (subtract from token_balance)
    // Note: In production, you might want to track this differently
    // For now, we just log it to token_ledger as an event

    // Log payout event in token_ledger
    await client.query(
      `INSERT INTO mojomo.token_ledger (
        conversation_id, avatar_id, event_type,
        token_amount, new_ownership_pct, event_data
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        conversation_id,
        avatar_id,
        'payout_initiated',
        token_amount,
        ownership.ownership_pct,
        JSON.stringify({
          payout_id,
          payment_method: payment_method || null,
          vested_pct: ownership.vested_pct,
          available_before: ownership.available_tokens,
        }),
      ]
    );

    // Log payout event in conversation_events for audit trail
    await client.query(
      `INSERT INTO mojomo.conversation_events (
        conversation_id, event_type, event_data
      ) VALUES ($1, $2, $3)`,
      [
        conversation_id,
        'payout_initiated',
        JSON.stringify({
          avatar_id,
          payout_id,
          token_amount,
          payment_method: payment_method || null,
        }),
      ]
    );

    return {
      payout_id,
      status: 'pending',
      avatar_id,
      amount: token_amount,
    };
  });
}

/**
 * Get payout details by ID
 */
export async function getPayout(payout_id: string): Promise<any> {
  const result = await db.query('SELECT * FROM mojomo.payouts WHERE id = $1', [payout_id]);

  if (result.rows.length === 0) {
    throw new Error('Payout not found');
  }

  return result.rows[0];
}

/**
 * List payouts for a conversation
 */
export async function listPayouts(
  conversation_id: string,
  limit: number = 50,
  offset: number = 0
): Promise<any[]> {
  const result = await db.query(
    `SELECT * FROM mojomo.payouts
     WHERE conversation_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [conversation_id, limit, offset]
  );

  return result.rows;
}

export default {
  validatePayoutRequest,
  getVestingStatus,
  initiatePayout,
  getPayout,
  listPayouts,
};
