// Sprint 10 Task 1: settlement dry-run.
// The rule under test: settlePayouts() must move no money unless explicitly told to,
// and must never send while the project is in MGP.
import { v4 as uuidv4 } from 'uuid';
import * as db from '../../src/services/db';
import * as settlement from '../../src/services/settlement';
import * as wallet from '../../src/services/wallet';

const userId = uuidv4();
const avatarId = uuidv4();
const convId = uuidv4();
const payoutWithAddr = uuidv4();
const payoutNoAddr = uuidv4();
const payoutSettled = uuidv4();
const ADDR = '0x1111111111111111111111111111111111111111';

beforeAll(async () => {
  await db.query('INSERT INTO mojomo.users (id, email) VALUES ($1,$2)', [userId, `s10s-${Date.now()}@test.com`]);
  await db.query(
    `INSERT INTO mojomo.avatars (id, user_id, name, avatar_type) VALUES ($1,$2,'S10 Settle','individual')`,
    [avatarId, userId]
  );
  await db.query(
    `INSERT INTO mojomo.conversations (id, initiator_avatar_id, target_avatar_id, title, status, total_tokens, ownership_ledger)
     VALUES ($1,$2,$2,'S10 settle conv','active',1000,'{}'::jsonb)`,
    [convId, avatarId]
  );
  await db.query(
    `INSERT INTO mojomo.payouts (id, conversation_id, avatar_id, token_amount, status, chain, recipient_address, tx_hash)
     VALUES ($1,$4,$5,100,'pending','polygon',$6,NULL),
            ($2,$4,$5,50,'pending','polygon',NULL,NULL),
            ($3,$4,$5,25,'settled','polygon',$6,'0xdeadbeef')`,
    [payoutWithAddr, payoutNoAddr, payoutSettled, convId, avatarId, ADDR]
  );
});

afterAll(async () => {
  await db.query('DELETE FROM mojomo.payouts WHERE conversation_id = $1', [convId]);
  await db.query('DELETE FROM mojomo.conversations WHERE id = $1', [convId]);
  await db.query('DELETE FROM mojomo.users WHERE id = $1', [userId]);
});

describe('settlement dry run', () => {
  it('defaults to dry run and sends nothing', async () => {
    const r = await settlement.settlePayouts();
    expect(r.dry_run).toBe(true);
    expect(r.sent_total).toBe('0.00');
  });

  it('reports what it would send', async () => {
    const r = await settlement.settlePayouts({ dryRun: true });
    const line = r.lines.find(l => l.payout_id === payoutWithAddr);
    expect(line).toBeDefined();
    expect(line!.action).toBe('would_send');
    expect(line!.amount).toBe('100.00');
    expect(line!.recipient_address).toBe(ADDR);
  });

  it('skips a payout with no recipient address instead of failing', async () => {
    const r = await settlement.settlePayouts({ dryRun: true });
    const line = r.lines.find(l => l.payout_id === payoutNoAddr);
    expect(line!.action).toBe('skipped_no_address');
  });

  it('never re-sends a payout that already has a tx hash', async () => {
    const r = await settlement.settlePayouts({ dryRun: true });
    const line = r.lines.find(l => l.payout_id === payoutSettled);
    // settled rows are not even selected (status != pending)
    expect(line).toBeUndefined();
  });

  it('leaves every payout untouched after a dry run', async () => {
    await settlement.settlePayouts({ dryRun: true });
    const r = await db.query('SELECT id, status, tx_hash FROM mojomo.payouts WHERE id = $1', [payoutWithAddr]);
    expect(r.rows[0].status).toBe('pending');
    expect(r.rows[0].tx_hash).toBeNull();
  });

  it('reports ledger_only true while in MVP', async () => {
    const r = await settlement.settlePayouts({ dryRun: true });
    expect(r.ledger_only).toBe(wallet.isLedgerOnly());
  });

  it('refuses to send while in MVP even when dry_run is false', async () => {
    const r = await settlement.settlePayouts({ dryRun: false });
    const line = r.lines.find(l => l.payout_id === payoutWithAddr);
    expect(line!.action).toBe('failed');
    expect(line!.error).toMatch(/MVP/i);
    expect(r.sent_total).toBe('0.00');
  });
});
