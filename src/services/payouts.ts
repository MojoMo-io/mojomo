// Payout & vesting service.
// Withdrawable balance = vested tokens (30-day linear, frozen at conversation end) minus payouts already
// taken. Payouts are serialized per conversation with a row lock so concurrent requests cannot double-spend.
import { v4 as uuidv4 } from 'uuid';
import * as db from './db';
import * as conversationService from './conversations';
import { AvatarOwnershipAtTime, ValidatePayoutResult } from '../types';

type Queryable = { query: (text: string, params?: any[]) => Promise<any> };
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Tokens already paid out (pending or completed) for this avatar in this conversation. */
export async function getPaidOutTokens(
  avatar_id: string,
  conversation_id: string,
  client?: Queryable
): Promise<number> {
  const q = client ? client.query.bind(client) : db.query;
  const r = await q(
    `SELECT COALESCE(SUM(token_amount), 0) AS paid FROM mojomo.payouts
     WHERE avatar_id = $1 AND conversation_id = $2 AND status NOT IN ('failed', 'cancelled')`,
    [avatar_id, conversation_id]
  );
  return round2(parseFloat(r.rows[0].paid));
}

/** Vesting view with prior payouts deducted: available_tokens is what can actually be withdrawn now. */
export async function getWithdrawableOwnership(
  avatar_id: string,
  conversation_id: string,
  client?: Queryable
): Promise<AvatarOwnershipAtTime> {
  const ownership = await conversationService.calculateAvatarOwnershipAtTime(
    avatar_id,
    conversation_id,
    new Date(),
    client
  );
  const paid = await getPaidOutTokens(avatar_id, conversation_id, client);
  return {
    ...ownership,
    paid_out_tokens: paid,
    available_tokens: round2(Math.max(0, ownership.available_tokens - paid)),
  };
}

/**
 * Validate a payout request against the withdrawable balance (spec 4.1.2 "Payout Validation").
 */
export async function validatePayoutRequest(
  avatar_id: string,
  conversation_id: string,
  requested_amount: number,
  client?: Queryable
): Promise<ValidatePayoutResult> {
  try {
    const ownership = await getWithdrawableOwnership(avatar_id, conversation_id, client);
    if (requested_amount <= 0) {
      return { valid: false, error: 'Amount must be positive' };
    }
    if (requested_amount > ownership.available_tokens) {
      const days_remaining = Math.ceil(
        (ownership.vesting_end_date.getTime() - Date.now()) / (24 * 60 * 60 * 1000)
      );
      const days_remaining_text =
        days_remaining > 0 ? `${days_remaining} days remaining` : 'vesting complete';
      return {
        valid: false,
        error:
          `Insufficient vested tokens. Requested: ${requested_amount}, ` +
          `Available: ${ownership.available_tokens.toFixed(2)}, ` +
          `Already paid out: ${(ownership.paid_out_tokens || 0).toFixed(2)}, ` +
          `Locked: ${ownership.locked_tokens.toFixed(2)} (${days_remaining_text})`,
      };
    }
    return { valid: true };
  } catch (error: any) {
    return { valid: false, error: error.message || 'Validation failed' };
  }
}

/** Vesting status for an avatar, net of payouts already taken. */
export async function getVestingStatus(
  avatar_id: string,
  conversation_id: string
): Promise<AvatarOwnershipAtTime> {
  return getWithdrawableOwnership(avatar_id, conversation_id);
}

/**
 * Initiate a payout. Runs entirely inside one transaction holding a row lock on the conversation, so
 * validation (which reads prior payouts) and the insert are atomic with respect to concurrent requests.
 */
export async function initiatePayout(
  avatar_id: string,
  conversation_id: string,
  token_amount: number,
  payment_method?: string
): Promise<{ payout_id: string; status: string; avatar_id: string; amount: number }> {
  return db.withTransaction(async (client) => {
    const lock = await client.query(
      'SELECT id FROM mojomo.conversations WHERE id = $1 FOR UPDATE',
      [conversation_id]
    );
    if (lock.rows.length === 0) {
      throw new Error('Conversation not found');
    }
    const validation = await validatePayoutRequest(avatar_id, conversation_id, token_amount, client);
    if (!validation.valid) {
      throw new Error(validation.error || 'Payout validation failed');
    }
    const ownership = await getWithdrawableOwnership(avatar_id, conversation_id, client);
    const payout_id = uuidv4();

    await client.query(
      `INSERT INTO mojomo.payouts (
        id, conversation_id, avatar_id, token_amount, payment_method, status
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [payout_id, conversation_id, avatar_id, token_amount, payment_method || null, 'pending']
    );
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
          paid_out_before: ownership.paid_out_tokens || 0,
        }),
      ]
    );
    await client.query(
      `INSERT INTO mojomo.conversation_events (
        conversation_id, event_type, event_data
      ) VALUES ($1, $2, $3)`,
      [
        conversation_id,
        'payout_initiated',
        JSON.stringify({ avatar_id, payout_id, token_amount, payment_method: payment_method || null }),
      ]
    );
    return { payout_id, status: 'pending', avatar_id, amount: token_amount };
  });
}

export async function getPayout(payout_id: string): Promise<any> {
  const result = await db.query('SELECT * FROM mojomo.payouts WHERE id = $1', [payout_id]);
  if (result.rows.length === 0) {
    throw new Error('Payout not found');
  }
  return result.rows[0];
}

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
  getPaidOutTokens,
  getWithdrawableOwnership,
  validatePayoutRequest,
  getVestingStatus,
  initiatePayout,
  getPayout,
  listPayouts,
};
