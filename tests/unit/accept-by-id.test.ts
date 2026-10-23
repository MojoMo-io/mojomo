// Regression: the by-invitation route used to pass inv.token_hash into
// acceptInvitation(), which hashes its argument. token_hash is already a hash,
// so it was hashed twice and never matched — Accept from /invitations returned
// 404 for every invitation. acceptInvitationById takes the row directly.
import * as db from '../../src/services/db';
import * as agents from '../../src/services/agents';

jest.mock('../../src/services/db');
const mockQuery = db.query as jest.MockedFunction<typeof db.query>;

describe('acceptInvitationById', () => {
  beforeEach(() => jest.clearAllMocks());

  it('tethers without re-hashing the token', async () => {
    const inv = {
      id: 'inv-1', agent_id: 'agent-1', human_email: 'h@example.com',
      status: 'pending', expires_at: new Date(Date.now() + 86400000),
      token_hash: 'already-a-hash', handle: 'test-agent',
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [{ status: 'pending', tether_user_id: null }] } as any) // guard
      .mockResolvedValueOnce({ rows: [{ id: 'user-1' }] } as any)                          // user
      .mockResolvedValueOnce({ rows: [{ id: 'agent-1', handle: 'test-agent', status: 'active', tether_user_id: 'user-1' }] } as any) // activate
      .mockResolvedValueOnce({ rows: [] } as any)                                          // invitation update
      .mockResolvedValueOnce({ rows: [] } as any)                                          // tether event
      .mockResolvedValueOnce({ rows: [{ status: 'active', tether_user_id: 'user-1' }] } as any) // issueKey guard
      .mockResolvedValueOnce({ rows: [{ id: 'key-1' }] } as any);                          // issueKey insert

    const out = await agents.acceptInvitationById(inv, { via: 'web', identity_via: 'session' });
    expect(out.agent.id).toBe('agent-1');
    // The critical assertion: no query ever received the double-hashed value.
    const allParams = mockQuery.mock.calls.flatMap(c => c[1] || []);
    expect(allParams).not.toContain('already-a-hash');
  });

  it('refuses an agent that is already tethered', async () => {
    const inv = { id: 'inv-1', agent_id: 'agent-1', human_email: 'h@example.com',
                  status: 'pending', expires_at: new Date(Date.now() + 86400000) };
    mockQuery.mockResolvedValueOnce({ rows: [{ status: 'active', tether_user_id: 'user-1' }] } as any);
    await expect(agents.acceptInvitationById(inv, { via: 'web', identity_via: 'session' }))
      .rejects.toMatchObject({ code: 'ALREADY_TETHERED' });
  });
});
