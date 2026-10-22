// Sprint 11.4 — the operator surface.
//
// Paying an idea is a deliberate operator act. The wallet endpoint must never
// leak the key, and the payout endpoint must refuse an overdraw.
import * as db from '../../src/services/db';
import * as ideaPayouts from '../../src/services/ideaPayouts';
import * as wallet from '../../src/services/wallet';

jest.mock('../../src/services/db', () => ({ query: jest.fn(), getClient: jest.fn() }));
const mockGetClient = db.getClient as jest.Mock;

const OLD = { ...process.env };
afterEach(() => { process.env = { ...OLD }; });

describe('wallet endpoint shape', () => {
  it('exposes chain and address but never the key', () => {
    process.env.MOJO_CHAIN = 'polygon';
    process.env.MOJO_WALLET_PRIVATE_KEY = '0x' + '11'.repeat(32);
    const c = wallet.activeChain();
    const payload = {
      chain: c.name, chain_id: c.chainId, address: wallet.walletAddress(),
      ledger_only: wallet.isLedgerOnly(), token_configured: Boolean(c.tokenAddress),
    };
    const json = JSON.stringify(payload);
    expect(json).not.toContain('11'.repeat(32));
    expect(json).not.toContain('private');
    expect(payload.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});

describe('payout refusal surfaces as 422', () => {
  it('refuses an overdraw with a code the route can map', async () => {
    process.env.MOJO_STAGE = 'mgp';
    process.env.MOJO_CHAIN = 'polygon';
    mockGetClient.mockResolvedValue({
      query: jest.fn(async (sql: string) =>
        sql.includes('SELECT id, balance FROM mojomo.payout_float')
          ? { rows: [{ id: 'f1', balance: '1' }] } : { rows: [] }),
      release: jest.fn(),
    });
    await expect(ideaPayouts.payIdea({ idea_id: 'i1', amount: '100' }))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_FLOAT' });
  });
});
