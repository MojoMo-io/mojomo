// Sprint 11.4 — MOJO payouts and the hot wallet.
//
// Two things must hold: the chain is configuration (Polygon today, Ethereum by
// env change), and nothing moves on-chain while the project is in MGP.
import * as db from '../../src/services/db';
import * as wallet from '../../src/services/wallet';
import * as ideaPayouts from '../../src/services/ideaPayouts';

jest.mock('../../src/services/db', () => ({ query: jest.fn(), getClient: jest.fn() }));
const mockQuery = db.query as jest.Mock;
const mockGetClient = db.getClient as jest.Mock;

const OLD = { ...process.env };
afterEach(() => { process.env = { ...OLD }; });

describe('chain is configuration', () => {
  it('defaults to polygon', () => {
    delete process.env.MOJO_CHAIN;
    expect(wallet.activeChain().name).toBe('polygon');
    expect(wallet.activeChain().chainId).toBe(137);
  });

  it('switches to ethereum by env alone', () => {
    process.env.MOJO_CHAIN = 'ethereum';
    expect(wallet.activeChain().name).toBe('ethereum');
    expect(wallet.activeChain().chainId).toBe(1);
  });

  it('rejects an unknown chain', () => {
    process.env.MOJO_CHAIN = 'solana';
    expect(() => wallet.activeChain()).toThrow(/Unknown MOJO_CHAIN/);
  });
});

describe('ledger-only gate', () => {
  it('is ledger-only by default', () => {
    delete process.env.MOJO_STAGE;
    expect(wallet.isLedgerOnly()).toBe(true);
  });

  it('is ledger-only in mgp', () => {
    process.env.MOJO_STAGE = 'mgp';
    expect(wallet.isLedgerOnly()).toBe(true);
  });

  it('is not ledger-only when live', () => {
    process.env.MOJO_STAGE = 'live';
    expect(wallet.isLedgerOnly()).toBe(false);
  });

  it('refuses to send while ledger-only', async () => {
    process.env.MOJO_STAGE = 'mgp';
    await expect(wallet.sendMojo('0x0000000000000000000000000000000000000001', '1'))
      .rejects.toThrow(/Ledger-only/);
  });
});

describe('idea payouts', () => {
  function client(balance: string) {
    const q = jest.fn(async (sql: string) => {
      if (sql.includes('SELECT id, balance FROM mojomo.payout_float')) return { rows: [{ id: 'f1', balance }] };
      if (sql.includes('INSERT INTO mojomo.payouts')) return { rows: [{ id: 'p1', amount: '10', status: 'paid' }] };
      return { rows: [] };
    });
    return { query: q, release: jest.fn() };
  }

  it('pays from the float and decrements it while in MGP', async () => {
    process.env.MOJO_STAGE = 'mgp';
    process.env.MOJO_CHAIN = 'polygon';
    const c = client('100');
    mockGetClient.mockResolvedValue(c);
    const p = await ideaPayouts.payIdea({ idea_id: 'i1', amount: '10' });
    expect(p.status).toBe('paid');
    const dec = c.query.mock.calls.find((x: any) => String(x[0]).includes('UPDATE mojomo.payout_float'));
    expect(dec).toBeTruthy();
  });

  it('refuses a payout that would overdraw the float', async () => {
    process.env.MOJO_STAGE = 'mgp';
    mockGetClient.mockResolvedValue(client('5'));
    await expect(ideaPayouts.payIdea({ idea_id: 'i1', amount: '10' }))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_FLOAT' });
  });

  it('refuses a non-positive amount', async () => {
    await expect(ideaPayouts.payIdea({ idea_id: 'i1', amount: '0' }))
      .rejects.toMatchObject({ code: 'BAD_AMOUNT' });
  });

  it('requires an address when live', async () => {
    process.env.MOJO_STAGE = 'live';
    await expect(ideaPayouts.payIdea({ idea_id: 'i1', amount: '10' }))
      .rejects.toMatchObject({ code: 'NO_ADDRESS' });
  });

  it('refuses when no float exists for the chain', async () => {
    process.env.MOJO_STAGE = 'mgp';
    const c = { query: jest.fn(async (sql: string) => sql.includes('payout_float') ? { rows: [] } : { rows: [] }), release: jest.fn() };
    mockGetClient.mockResolvedValue(c);
    await expect(ideaPayouts.payIdea({ idea_id: 'i1', amount: '10' }))
      .rejects.toMatchObject({ code: 'NO_FLOAT' });
  });
});
