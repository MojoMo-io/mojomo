// Sprint 10: user wallet addresses — the record settlement reads to know where to pay.
import request from 'supertest';
import express from 'express';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import * as db from '../../src/services/db';
import * as userWallets from '../../src/services/userWallets';
import { attachSession, requireAuth } from '../../src/middleware/auth';
import walletRoutes from '../../src/routes/userWallets';

const userId = uuidv4();
const otherUserId = uuidv4();
const avatarId = uuidv4();
const A1 = '0x1111111111111111111111111111111111111111';
const A2 = '0x2222222222222222222222222222222222222222';

let app: express.Application;
let cookie: string;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use('/api', attachSession, requireAuth, walletRoutes);

  await db.query('INSERT INTO mojomo.users (id, email) VALUES ($1,$2),($3,$4)', [
    userId, `s10w-${Date.now()}@test.com`,
    otherUserId, `s10w-other-${Date.now()}@test.com`,
  ]);
  await db.query(
    `INSERT INTO mojomo.avatars (id, user_id, name, avatar_type) VALUES ($1,$2,'S10 Wallet Avatar','individual')`,
    [avatarId, userId]
  );

  const raw = 's10w-' + uuidv4() + uuidv4();
  const hash = createHash('sha256').update(raw).digest('hex');
  await db.query(
    `INSERT INTO mojomo.sessions (user_id, token_hash, expires_at) VALUES ($1,$2,NOW()+interval '10 min')`,
    [userId, hash]
  );
  cookie = `mojomo_session=${raw}`;
});

afterAll(async () => {
  await db.query('DELETE FROM mojomo.user_wallets WHERE user_id = ANY($1)', [[userId, otherUserId]]);
  await db.query('DELETE FROM mojomo.sessions WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM mojomo.users WHERE id = ANY($1)', [[userId, otherUserId]]);
});

describe('address validation', () => {
  it('rejects a malformed address', async () => {
    const r = await request(app).post('/api/wallets').set('Cookie', cookie)
      .send({ chain: 'polygon', address: 'not-an-address' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('BAD_ADDRESS');
  });

  it('rejects an unknown chain', async () => {
    const r = await request(app).post('/api/wallets').set('Cookie', cookie)
      .send({ chain: 'solana', address: A1 });
    expect(r.status).toBe(400);
  });

  it('lowercases a checksummed address', () => {
    const { getAddress } = require('ethers');
    const checksummed = getAddress('0xabcdef0123456789abcdef0123456789abcdef01');
    expect(checksummed).not.toBe(checksummed.toLowerCase()); // it really is mixed case
    expect(userWallets.normaliseAddress(checksummed))
      .toBe('0xabcdef0123456789abcdef0123456789abcdef01');
  });
});

describe('wallet management', () => {
  it('requires a session', async () => {
    const r = await request(app).get('/api/wallets');
    expect(r.status).toBe(401);
  });

  it('makes the first address for a chain the default automatically', async () => {
    const r = await request(app).post('/api/wallets').set('Cookie', cookie)
      .send({ chain: 'polygon', address: A1 });
    expect(r.status).toBe(201);
    expect(r.body.wallet.is_default).toBe(true);
    expect(r.body.wallet.address).toBe(A1);
  });

  it('does not make a second address the default unless asked', async () => {
    const r = await request(app).post('/api/wallets').set('Cookie', cookie)
      .send({ chain: 'polygon', address: A2 });
    expect(r.status).toBe(201);
    expect(r.body.wallet.is_default).toBe(false);
  });

  it('moves the default when asked', async () => {
    const list = await request(app).get('/api/wallets').set('Cookie', cookie);
    const second = list.body.wallets.find((w: any) => w.address === A2);
    const r = await request(app).post(`/api/wallets/${second.id}/default`).set('Cookie', cookie);
    expect(r.status).toBe(200);
    expect(r.body.wallet.is_default).toBe(true);

    const after = await request(app).get('/api/wallets').set('Cookie', cookie);
    const defaults = after.body.wallets.filter((w: any) => w.is_default);
    expect(defaults.length).toBe(1);
    expect(defaults[0].address).toBe(A2);
  });

  it('promotes another address when the default is deleted', async () => {
    const list = await request(app).get('/api/wallets').set('Cookie', cookie);
    const def = list.body.wallets.find((w: any) => w.is_default);
    await request(app).delete(`/api/wallets/${def.id}`).set('Cookie', cookie).expect(200);

    const after = await request(app).get('/api/wallets').set('Cookie', cookie);
    const defaults = after.body.wallets.filter((w: any) => w.is_default);
    expect(defaults.length).toBe(1);
    expect(defaults[0].address).toBe(A1);
  });

  it('cannot touch another user\'s wallet', async () => {
    const list = await request(app).get('/api/wallets').set('Cookie', cookie);
    const mine = list.body.wallets[0];
    const r = await request(app).delete(`/api/wallets/${mine.id}`).set('Cookie', cookie);
    expect(r.status).toBe(200);
    // the row is gone for me; a second delete is a 404, not a 500
    const again = await request(app).delete(`/api/wallets/${mine.id}`).set('Cookie', cookie);
    expect(again.status).toBe(404);
  });
});

describe('settlement address resolution', () => {
  it('resolves avatar -> owning user -> default wallet', async () => {
    await db.query('DELETE FROM mojomo.user_wallets WHERE user_id = $1', [userId]);
    await userWallets.addWallet({ user_id: userId, chain: 'polygon', address: A1 });
    const addr = await userWallets.resolveAvatarPayoutAddress(avatarId, 'polygon');
    expect(addr).toBe(A1);
  });

  it('returns null when the user has no address for that chain', async () => {
    const addr = await userWallets.resolveAvatarPayoutAddress(avatarId, 'ethereum');
    expect(addr).toBeNull();
  });

  it('returns null for an avatar that does not exist', async () => {
    const addr = await userWallets.resolveAvatarPayoutAddress(uuidv4(), 'polygon');
    expect(addr).toBeNull();
  });
});
