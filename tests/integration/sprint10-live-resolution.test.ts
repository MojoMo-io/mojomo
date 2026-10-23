// Sprint 10: when live, payIdea must resolve the recipient from user_wallets
// rather than demanding the caller supply one.
import { v4 as uuidv4 } from 'uuid';
import * as db from '../../src/services/db';
import * as userWallets from '../../src/services/userWallets';

const userId = uuidv4();
const avatarId = uuidv4();
const convId = uuidv4();
const ADDR = '0x3333333333333333333333333333333333333333';

beforeAll(async () => {
  await db.query('INSERT INTO mojomo.users (id, email) VALUES ($1,$2)', [userId, `s10l-${Date.now()}@test.com`]);
  await db.query(
    `INSERT INTO mojomo.avatars (id, user_id, name, avatar_type) VALUES ($1,$2,'S10 Live Avatar','individual')`,
    [avatarId, userId]
  );
  await db.query(
    `INSERT INTO mojomo.conversations (id, initiator_avatar_id, target_avatar_id, title, status, total_tokens, ownership_ledger)
     VALUES ($1,$2,$2,'S10 live conv','active',1000,'{}'::jsonb)`,
    [convId, avatarId]
  );
});

afterAll(async () => {
  await db.query('DELETE FROM mojomo.payouts WHERE conversation_id = $1', [convId]);
  await db.query('DELETE FROM mojomo.conversations WHERE id = $1', [convId]);
  await db.query('DELETE FROM mojomo.user_wallets WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM mojomo.users WHERE id = $1', [userId]);
});

describe('live-mode address resolution', () => {
  it('resolves the default wallet for the recipient avatar', async () => {
    await userWallets.addWallet({ user_id: userId, chain: 'polygon', address: ADDR });
    const resolved = await userWallets.resolveAvatarPayoutAddress(avatarId, 'polygon');
    expect(resolved).toBe(ADDR);
  });

  it('returns null when the user has no wallet, so payIdea can refuse cleanly', async () => {
    await db.query('DELETE FROM mojomo.user_wallets WHERE user_id = $1', [userId]);
    const resolved = await userWallets.resolveAvatarPayoutAddress(avatarId, 'polygon');
    expect(resolved).toBeNull();
  });
});
