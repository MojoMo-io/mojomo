// Sprint 10 — settlement.
//
// The gap this closes: payIdea() writes a payout row with status='pending' when the
// project is live, and markSettled() can flip it to 'settled' — but nothing ever
// called sendMojo(). The economy computed; it never paid.
//
// Two rules, both deliberate:
//
//   1. DRY RUN IS THE DEFAULT. settlePayouts() moves no money unless the caller
//      explicitly passes dryRun: false. The operator reviews the dry-run output first.
//   2. It refuses to run at all while the project is in MVP. sendMojo() already
//      throws in that state, but we check first so a dry run in MVP reports the
//      truth ("would send") instead of throwing.
//
// Idempotency: a payout that already carries a tx_hash is never re-sent. The
// markSettled() UPDATE is additionally guarded on status='pending', so a double
// call cannot settle the same row twice.

import * as db from './db';
import * as wallet from './wallet';
import { markSettled } from './ideaPayouts';
import { resolveAvatarPayoutAddress } from './userWallets';

export interface SettlementLine {
  payout_id: string;
  conversation_id: string | null;
  avatar_id: string | null;
  amount: string;
  recipient_address: string | null;
  action: 'would_send' | 'sent' | 'skipped_no_address' | 'skipped_already_settled' | 'failed';
  tx_hash?: string;
  error?: string;
}

export interface SettlementReport {
  dry_run: boolean;
  ledger_only: boolean;
  chain: string;
  float_balance: string | null;
  considered: number;
  would_send_total: string;
  sent_total: string;
  lines: SettlementLine[];
}

/**
 * Settle pending payouts.
 *
 * @param opts.dryRun  default true. Pass false to actually send.
 * @param opts.limit   max payouts to consider in one pass (default 50).
 */
export async function settlePayouts(
  opts: { dryRun?: boolean; limit?: number } = {}
): Promise<SettlementReport> {
  const dryRun = opts.dryRun !== false; // default true
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const chain = wallet.activeChain().name;
  const ledgerOnly = wallet.isLedgerOnly();

  const floatRow = await db.query(
    `SELECT balance FROM mojomo.payout_float WHERE chain = $1 ORDER BY updated_at DESC LIMIT 1`,
    [chain]
  );
  const floatBalance = floatRow.rows[0] ? String(floatRow.rows[0].balance) : null;

  const pending = await db.query(
    `SELECT id, conversation_id, avatar_id, token_amount, recipient_address, tx_hash
       FROM mojomo.payouts
      WHERE status = 'pending' AND chain = $1
      ORDER BY created_at ASC
      LIMIT $2`,
    [chain, limit]
  );

  const lines: SettlementLine[] = [];
  let wouldSend = 0;
  let sent = 0;

  for (const row of pending.rows) {
    const amount = String(row.token_amount);
    const base = {
      payout_id: row.id,
      conversation_id: row.conversation_id,
      avatar_id: row.avatar_id,
      amount,
      recipient_address: row.recipient_address,
    };

    // Already carries a tx hash: never re-send.
    if (row.tx_hash) {
      lines.push({ ...base, action: 'skipped_already_settled' });
      continue;
    }

    // Resolve the address: prefer what the payout recorded, else look up the
    // avatar's owning user's default wallet for this chain.
    let recipient = row.recipient_address as string | null;
    if (!recipient && row.avatar_id) {
      recipient = await resolveAvatarPayoutAddress(row.avatar_id, chain);
      if (recipient) base.recipient_address = recipient;
    }

    // Still no address: skip, do not fail the whole run.
    if (!recipient) {
      lines.push({ ...base, action: 'skipped_no_address' });
      continue;
    }

    if (dryRun) {
      lines.push({ ...base, action: 'would_send' });
      wouldSend += Number(amount);
      continue;
    }

    // Live send. Refuse outright while in MVP.
    if (ledgerOnly) {
      lines.push({ ...base, action: 'failed', error: 'Project is in MVP; on-chain settlement disabled' });
      continue;
    }

    try {
      const { txHash } = await wallet.sendMojo(recipient, amount);
      await markSettled(row.id, txHash);
      lines.push({ ...base, action: 'sent', tx_hash: txHash });
      sent += Number(amount);
    } catch (e: any) {
      // Record the failure without touching status, so a retry can pick it up.
      await db.query(
        `UPDATE mojomo.payouts SET status = 'failed', updated_at = now() WHERE id = $1 AND status = 'pending'`,
        [row.id]
      );
      lines.push({ ...base, action: 'failed', error: e.message });
    }
  }

  return {
    dry_run: dryRun,
    ledger_only: ledgerOnly,
    chain,
    float_balance: floatBalance,
    considered: pending.rows.length,
    would_send_total: wouldSend.toFixed(2),
    sent_total: sent.toFixed(2),
    lines,
  };
}
