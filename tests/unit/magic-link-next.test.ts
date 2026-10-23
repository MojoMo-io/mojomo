import * as db from '../../src/services/db';
import * as auth from '../../src/services/auth';

jest.mock('../../src/services/db');
const mockQuery = db.query as jest.MockedFunction<typeof db.query>;

describe('magic link next= destination', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [] } as any);
  });

  it('carries a same-site path through to the verify URL', async () => {
    const r = await auth.createMagicLink('a@b.com', '/decisions');
    expect(r.url).toContain('next=%2Fdecisions');
  });

  it('drops an absolute URL so the link cannot be used as an open redirect', async () => {
    const r = await auth.createMagicLink('a@b.com', 'https://evil.example/x');
    expect(r.url).not.toContain('evil');
  });

  it('drops a protocol-relative URL', async () => {
    const r = await auth.createMagicLink('a@b.com', '//evil.example/x');
    expect(r.url).not.toContain('evil');
  });

  it('omits next entirely when none is given', async () => {
    const r = await auth.createMagicLink('a@b.com');
    expect(r.url).not.toContain('next=');
  });
});
