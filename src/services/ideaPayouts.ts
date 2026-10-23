// Sprint 11.4 — idea payouts in MOJO.
//
// An idea that earns a payout is paid in MOJO, drawn from the float. While the
// project is in MVP the payout is recorded and the float is decremented in the
// ledger, but nothing moves on-chain. At go-live, paid payouts settle to wallet
// addresses.
//
// The float is the constraint. A payout that would overdraw it is refused, not
// queued: an IOU the float cannot cover is a promise we cannot keep.

import * as db from './db';
import { activeChain, isLedgerOnly } from './wallet';
import { resolveAvatarPayoutAddress } from './userWallets';

export class PayoutRefused extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'PayoutRefused';
  }
}

export interface IdeaPayout {
  id: string;
  amount: string;
  token_symbol: string;
  chain: string;
  status: string;
  tx_hash: string | null;
}

/**
 * Pay an idea in MOJO. Ledger-only while in MVP.
 */
export async function payIdea(input: {
  idea_id: string;
  conversation_id?: string;
  recipient_avatar_id?: string;
  recipient_address?: string;
  amount: string;
  reason?: string;
}): Promise<IdeaPayout> {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new PayoutRefused('BAD_AMOUNT', 'Amount must be positive');

  const chain = activeChain().name;
  const ledgerOnly = isLedgerOnly();

  // Resolve the address before refusing: prefer an explicit one, else the
  // recipient avatar's owning user's default wallet for this chain.
  let recipient = input.recipient_address || null;
  if (!ledgerOnly && !recipient && input.recipient_avatar_id) {
    recipient = await resolveAvatarPayoutAddress(input.recipient_avatar_id, chain);
  }
  if (!ledgerOnly && !recipient) {
    throw new PayoutRefused('NO_ADDRESS', 'On-chain settlement requires a recipient address');
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Lock the float row so two payouts cannot overdraw it.
    const f = await client.query(
      `SELECT id, balance FROM mojomo.payout_float WHERE chain = $1 ORDER BY updated_at DESC LIMIT 1 FOR UPDATE`,
      [chain]
    );
    if (f.rows.length === 0) throw new PayoutRefused('NO_FLOAT', `No MOJO float recorded for ${chain}`);
    const balance = Number(f.rows[0].balance);
    if (balance < amount) {
      throw new PayoutRefused('INSUFFICIENT_FLOAT', `Float holds ${balance} MOJO, payout needs ${amount}`);
    }

    await client.query(
      `UPDATE mojomo.payout_float SET balance = balance - $1, updated_at = now() WHERE id = $2`,
      [amount, f.rows[0].id]
    );

    const r = await client.query(
      `INSERT INTO mojomo.payouts
         (conversation_id, avatar_id, token_amount, payment_method, status,
          chain, token_symbol, recipient_address)
       VALUES ($1,$2,$3,'mojo',$4,$5,'MOJO',$6) RETURNING *`,
      [input.conversation_id || null, input.recipient_avatar_id || null, amount,
       ledgerOnly ? 'paid' : 'pending', chain, recipient]
    );

    await client.query('COMMIT');
    return r.rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Mark a pending payout as settled on-chain. */
export async function markSettled(payoutId: string, txHash: string): Promise<IdeaPayout> {
  const r = await db.query(
    `UPDATE mojomo.payouts SET status='settled', tx_hash=$2, settled_at=now(), updated_at=now()
      WHERE id=$1 AND status='pending' RETURNING *`,
    [payoutId, txHash]
  );
  if (r.rows.length === 0) throw new PayoutRefused('NOT_PENDING', 'Payout not found or not pending');
  return r.rows[0];
}

/** Float and payout totals, for the operator. */
export async function payoutSummary(): Promise<any> {
  const chain = activeChain().name;
  const f = await db.query(`SELECT balance, wallet_address, is_test_float FROM mojomo.payout_float WHERE chain=$1 ORDER BY updated_at DESC LIMIT 1`, [chain]);
  const p = await db.query(
    `SELECT status, COUNT(*)::int AS n, COALESCE(SUM(token_amount),0) AS total
       FROM mojomo.payouts WHERE chain=$1 GROUP BY status`, [chain]
  );
  return { chain, ledger_only: isLedgerOnly(), float: f.rows[0] || null, payouts: p.rows };
}
