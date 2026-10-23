// Regression: re-registration used to rotate agent.invitations.token_hash and
// silently kill every link already sitting in a human's inbox. The human saw
// "Invitation not found" on a link that had worked minutes earlier.
//
// The fix keeps superseded hashes in token_hash_history so old links still
// resolve. Single-use is unchanged: the invitation row is what gets consumed.
import { getInvitation } from '../../src/services/agents';
import * as db from '../../src/services/db';

jest.mock('../../src/services/db');

const mockQuery = db.query as jest.MockedFunction<typeof db.query>;

describe('getInvitation token history', () => {
  beforeEach(() => jest.clearAllMocks());

  it('matches on the current token_hash', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'inv-1', status: 'pending' }] } as any);
    const inv = await getInvitation('current-token');
    expect(inv).toEqual({ id: 'inv-1', status: 'pending' });
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('token_hash = $1');
  });

  it('also matches a superseded hash in token_hash_history', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'inv-1', status: 'pending' }] } as any);
    await getInvitation('old-token');
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('ANY(i.token_hash_history)');
  });

  it('returns null when neither the current nor any historic hash matches', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    expect(await getInvitation('nonsense')).toBeNull();
  });
});
