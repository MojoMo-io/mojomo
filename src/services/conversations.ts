// Conversation service with tokenomics
import { PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import * as db from './db';
import {
  Conversation,
  OwnershipLedger,
  OwnershipEntry,
  AvatarOwnershipAtTime,
  SpecialistJoinResult,
} from '../types';

/**
 * Allocate genesis tokens: 50/50 split between initiator and target
 */
export function allocateGenesisTokens(
  initiator_avatar_id: string,
  target_avatar_id: string,
  total_tokens: number
): OwnershipLedger {
  const half_tokens = total_tokens / 2;
  const half_pct = 50.0;

  return {
    [initiator_avatar_id]: {
      ownership_pct: half_pct,
      token_balance: half_tokens,
      vested_pct: 0,
      buy_in_amount: 0,
      join_round: 0,
    },
    [target_avatar_id]: {
      ownership_pct: half_pct,
      token_balance: half_tokens,
      vested_pct: 0,
      buy_in_amount: 0,
      join_round: 0,
    },
  };
}

/**
 * Create a new conversation between two avatars
 */
export async function createConversation(
  initiator_avatar_id: string,
  target_avatar_id: string,
  title: string,
  total_tokens: number,
  description?: string
): Promise<Conversation> {
  if (initiator_avatar_id === target_avatar_id) {
    throw new Error('Cannot create conversation with same avatar');
  }

  if (total_tokens <= 0) {
    throw new Error('total_tokens must be positive');
  }

  return db.withTransaction(async (client) => {
    // Verify both avatars exist
    const avatarsResult = await client.query(
      'SELECT id FROM mojomo.avatars WHERE id = ANY($1)',
      [[initiator_avatar_id, target_avatar_id]]
    );

    if (avatarsResult.rows.length !== 2) {
      throw new Error('One or both avatars not found');
    }

    // Allocate genesis tokens
    const ownership_ledger = allocateGenesisTokens(
      initiator_avatar_id,
      target_avatar_id,
      total_tokens
    );

    const conversation_id = uuidv4();

    // Create conversation
    const conversationResult = await client.query(
      `INSERT INTO mojomo.conversations (
        id, initiator_avatar_id, target_avatar_id, title, description,
        total_tokens, ownership_ledger, participant_avatar_ids
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        conversation_id,
        initiator_avatar_id,
        target_avatar_id,
        title,
        description || null,
        total_tokens,
        JSON.stringify(ownership_ledger),
        [initiator_avatar_id, target_avatar_id],
      ]
    );

    // Log creation event
    await client.query(
      `INSERT INTO mojomo.conversation_events (
        conversation_id, event_type, event_data
      ) VALUES ($1, $2, $3)`,
      [
        conversation_id,
        'created',
        JSON.stringify({
          initiator_avatar_id,
          target_avatar_id,
          total_tokens,
        }),
      ]
    );

    // Log genesis allocation for both avatars
    for (const [avatar_id, entry] of Object.entries(ownership_ledger)) {
      await client.query(
        `INSERT INTO mojomo.token_ledger (
          conversation_id, avatar_id, event_type,
          token_amount, new_ownership_pct, join_round
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          conversation_id,
          avatar_id,
          'genesis',
          entry.token_balance,
          entry.ownership_pct,
          0,
        ]
      );
    }

    const row = conversationResult.rows[0];
    return parseConversationRow(row);
  });
}

/**
 * Get conversation by ID
 */
export async function getConversation(conversation_id: string): Promise<Conversation> {
  const result = await db.query(
    'SELECT * FROM mojomo.conversations WHERE id = $1',
    [conversation_id]
  );

  if (result.rows.length === 0) {
    throw new Error('Conversation not found');
  }

  return parseConversationRow(result.rows[0]);
}

/**
 * List conversations for a user (as initiator, target, or specialist)
 */
export async function listConversationsForUser(
  user_id: string,
  limit: number = 50,
  offset: number = 0
): Promise<Conversation[]> {
  // Get all avatars for this user
  const avatarsResult = await db.query(
    'SELECT id FROM mojomo.avatars WHERE user_id = $1',
    [user_id]
  );

  if (avatarsResult.rows.length === 0) {
    return [];
  }

  const avatar_ids = avatarsResult.rows.map((r: any) => r.id);

  // Get conversations where user is participant
  const result = await db.query(
    `SELECT DISTINCT c.* FROM mojomo.conversations c
     WHERE c.initiator_avatar_id = ANY($1)
        OR c.target_avatar_id = ANY($1)
        OR c.participant_avatar_ids && $1
     ORDER BY c.created_at DESC
     LIMIT $2 OFFSET $3`,
    [avatar_ids, limit, offset]
  );

  return result.rows.map(parseConversationRow);
}

/**
 * Calculate avatar ownership at a specific time (for vesting)
 * Default timestamp = NOW()
 */
export async function calculateAvatarOwnershipAtTime(
  avatar_id: string,
  conversation_id: string,
  timestamp: Date = new Date()
): Promise<AvatarOwnershipAtTime> {
  const conversation = await getConversation(conversation_id);

  const entry = conversation.ownership_ledger[avatar_id];
  if (!entry) {
    throw new Error('Avatar not in conversation');
  }

  // Vesting period: 30 days from conversation creation
  const vesting_start = conversation.created_at;
  const vesting_end = new Date(vesting_start.getTime() + 30 * 24 * 60 * 60 * 1000);

  // Calculate vested percentage (linear)
  let vested_pct = 0;
  if (timestamp >= vesting_end) {
    vested_pct = 100;
  } else if (timestamp > vesting_start) {
    const elapsed_ms = timestamp.getTime() - vesting_start.getTime();
    const total_ms = vesting_end.getTime() - vesting_start.getTime();
    vested_pct = Math.round((elapsed_ms / total_ms) * 10000) / 100; // 2 decimals
  }

  const total = entry.token_balance;
  const available = Math.round((total * vested_pct) / 100 * 100) / 100;
  const locked = total - available;

  const days_elapsed = Math.floor(
    (timestamp.getTime() - vesting_start.getTime()) / (24 * 60 * 60 * 1000)
  );

  return {
    avatar_id,
    total_token_amount: total,
    genesis_or_bought: entry.buy_in_amount > 0 ? 'bought' : 'genesis',
    allocated_at: vesting_start,
    vesting_start_date: vesting_start,
    vesting_end_date: vesting_end,
    days_elapsed,
    vested_pct,
    available_tokens: available,
    locked_tokens: locked,
    ownership_pct: entry.ownership_pct,
    total_buy_in_tokens: entry.buy_in_amount || 0,
  };
}

/**
 * Validate that ownership ledger sums to 100% (±0.1% tolerance)
 */
export function validateOwnershipSum(ledger: OwnershipLedger): boolean {
  const total = Object.values(ledger).reduce((sum, entry) => sum + entry.ownership_pct, 0);
  return Math.abs(total - 100) < 0.1;
}

/**
 * Helper: Parse database row to Conversation object
 */
function parseConversationRow(row: any): Conversation {
  return {
    id: row.id,
    initiator_avatar_id: row.initiator_avatar_id,
    target_avatar_id: row.target_avatar_id,
    title: row.title,
    description: row.description,
    total_tokens: parseFloat(row.total_tokens),
    ownership_ledger:
      typeof row.ownership_ledger === 'string'
        ? JSON.parse(row.ownership_ledger)
        : row.ownership_ledger,
    participant_avatar_ids: row.participant_avatar_ids || [],
    status: row.status,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
    last_message_at: row.last_message_at ? new Date(row.last_message_at) : undefined,
    ended_at: row.ended_at ? new Date(row.ended_at) : undefined,
  };
}

export default {
  createConversation,
  getConversation,
  listConversationsForUser,
  calculateAvatarOwnershipAtTime,
  allocateGenesisTokens,
  validateOwnershipSum,
};
