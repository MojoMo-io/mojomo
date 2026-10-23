import * as db from '../../src/services/db';
import * as auth from '../../src/services/auth';

jest.mock('../../src/services/db');

describe('magic link reuse grace window', () => {
  it('accepts a token that was used moments ago, so a link prefetch does not burn it', async () => {
    const withTx = db.withTransaction as jest.MockedFunction<typeof db.withTransaction>;
    withTx.mockImplementation(async (fn: any) => fn({
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ email: 'a@b.com' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'u1' }] })
        .mockResolvedValueOnce({ rows: [] }),
    }));
    const r = await auth.consumeMagicLink('x'.repeat(40));
    expect(r.email).toBe('a@b.com');
  });

  it('rejects a token whose use is outside the grace window', async () => {
    const withTx = db.withTransaction as jest.MockedFunction<typeof db.withTransaction>;
    withTx.mockImplementation(async (fn: any) => fn({
      query: jest.fn().mockResolvedValueOnce({ rows: [] }),
    }));
    await expect(auth.consumeMagicLink('x'.repeat(40))).rejects.toThrow(/Invalid or expired/);
  });
});
