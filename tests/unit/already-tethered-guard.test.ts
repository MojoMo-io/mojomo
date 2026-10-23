// An agent that is already tethered must not be tethered again. Without this
// guard a re-invite silently re-activates the agent and mints a second API key,
// which looks to the human like their agent was re-committed behind their back.
import * as db from '../../src/services/db';
import * as agents from '../../src/services/agents';

jest.mock('../../src/services/db');

const mockQuery = db.query as jest.MockedFunction<typeof db.query>;

describe('acceptInvitation — already tethered guard', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuses to re-tether an agent that is already active', async () => {
    // getInvitation lookup
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'inv-1', agent_id: 'agent-1', human_email: 'h@example.com',
        status: 'pending', expires_at: new Date(Date.now() + 86400000),
        token_hash: 'hash', handle: 'test-agent',
      }],
    } as any);
    // the new guard's lookup
    mockQuery.mockResolvedValueOnce({
      rows: [{ status: 'active', tether_user_id: 'user-1', tether_verified_at: new Date() }],
    } as any);

    await expect(
      agents.acceptInvitation('hash', { via: 'web', identity_via: 'session' })
    ).rejects.toMatchObject({ code: 'ALREADY_TETHERED' });
  });
});
