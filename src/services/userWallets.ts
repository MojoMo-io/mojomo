// Sprint 10 — where a user wants to be paid.
//
// Settlement needs to resolve avatar -> user -> address. Before this, no such
// record existed: payouts.recipient_address was the only address column and
// nothing populated it.
//
// Rules:
//   1. Addresses are stored lowercased. EIP-55 checksums are a display concern.
//   2. At most one default per (user, chain). The DB enforces it; this service
//      clears the old default in the same transaction so the index never trips.
//   3. Setting the first address for a chain makes it the default automatically.
//   4. Deleting the default promotes another address for that chain, if one exists.

import { isAddress } from 'ethers';
import * as db from './db';

export interface UserWallet {
  id: string;
  user_id: string;
  chain: string;
  address: string;
  label: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export class WalletError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'WalletError';
  }
}

/** Normalise and validate an EVM address. Throws WalletError on bad input. */
export function normaliseAddress(input: string): string {
  const trimmed = (input || '').trim();
  if (!isAddress(trimmed)) {
    throw new WalletError('BAD_ADDRESS', 'Not a valid EVM address');
  }
  return trimmed.toLowerCase();
}

export async function listWallets(user_id: string, chain?: string): Promise<UserWallet[]> {
  const r = chain
    ? await db.query(
        `SELECT * FROM mojomo.user_wallets WHERE user_id = $1 AND chain = $2
          ORDER BY is_default DESC, created_at ASC`,
        [user_id, chain]
      )
    : await db.query(
        `SELECT * FROM mojomo.user_wallets WHERE user_id = $1
          ORDER BY chain ASC, is_default DESC, created_at ASC`,
        [user_id]
      );
  return r.rows;
}

/** The address settlement should pay. Null if the user has not set one. */
export async function getDefaultWallet(
  user_id: string,
  chain: string
): Promise<UserWallet | null> {
  const r = await db.query(
    `SELECT * FROM mojomo.user_wallets WHERE user_id = $1 AND chain = $2 AND is_default LIMIT 1`,
    [user_id, chain]
  );
  return r.rows[0] || null;
}

/**
 * Resolve the payout address for an avatar: avatar -> owning user -> default wallet.
 * Returns null when the user has not set an address for that chain.
 */
export async function resolveAvatarPayoutAddress(
  avatar_id: string,
  chain: string
): Promise<string | null> {
  const r = await db.query(
    `SELECT w.address
       FROM mojomo.avatars a
       JOIN mojomo.user_wallets w ON w.user_id = a.user_id
      WHERE a.id = $1 AND w.chain = $2 AND w.is_default
      LIMIT 1`,
    [avatar_id, chain]
  );
  return r.rows[0]?.address || null;
}

export async function addWallet(input: {
  user_id: string;
  chain: string;
  address: string;
  label?: string;
  make_default?: boolean;
}): Promise<UserWallet> {
  const address = normaliseAddress(input.address);

  return db.withTransaction(async (client) => {
    // First address for this chain becomes the default automatically.
    const existing = await client.query(
      `SELECT count(*)::int AS n FROM mojomo.user_wallets WHERE user_id = $1 AND chain = $2`,
      [input.user_id, input.chain]
    );
    const isFirst = existing.rows[0].n === 0;
    const makeDefault = input.make_default === true || isFirst;

    if (makeDefault) {
      await client.query(
        `UPDATE mojomo.user_wallets SET is_default = false, updated_at = now()
          WHERE user_id = $1 AND chain = $2 AND is_default`,
        [input.user_id, input.chain]
      );
    }

    const r = await client.query(
      `INSERT INTO mojomo.user_wallets (user_id, chain, address, label, is_default)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, chain, address)
       DO UPDATE SET label = COALESCE(EXCLUDED.label, mojomo.user_wallets.label),
                     is_default = EXCLUDED.is_default,
                     updated_at = now()
       RETURNING *`,
      [input.user_id, input.chain, address, input.label || null, makeDefault]
    );
    return r.rows[0];
  });
}

export async function setDefaultWallet(user_id: string, wallet_id: string): Promise<UserWallet> {
  return db.withTransaction(async (client) => {
    const target = await client.query(
      `SELECT * FROM mojomo.user_wallets WHERE id = $1 AND user_id = $2`,
      [wallet_id, user_id]
    );
    if (target.rows.length === 0) throw new WalletError('NOT_FOUND', 'Wallet not found');

    await client.query(
      `UPDATE mojomo.user_wallets SET is_default = false, updated_at = now()
        WHERE user_id = $1 AND chain = $2 AND is_default`,
      [user_id, target.rows[0].chain]
    );
    const r = await client.query(
      `UPDATE mojomo.user_wallets SET is_default = true, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [wallet_id]
    );
    return r.rows[0];
  });
}

export async function deleteWallet(user_id: string, wallet_id: string): Promise<void> {
  await db.withTransaction(async (client) => {
    const target = await client.query(
      `SELECT * FROM mojomo.user_wallets WHERE id = $1 AND user_id = $2`,
      [wallet_id, user_id]
    );
    if (target.rows.length === 0) throw new WalletError('NOT_FOUND', 'Wallet not found');
    const wasDefault = target.rows[0].is_default;
    const chain = target.rows[0].chain;

    await client.query(`DELETE FROM mojomo.user_wallets WHERE id = $1`, [wallet_id]);

    // Promote another address for the chain so the user is never left without a default.
    if (wasDefault) {
      await client.query(
        `UPDATE mojomo.user_wallets SET is_default = true, updated_at = now()
          WHERE id = (
            SELECT id FROM mojomo.user_wallets
             WHERE user_id = $1 AND chain = $2
             ORDER BY created_at ASC LIMIT 1
          )`,
        [user_id, chain]
      );
    }
  });
}
