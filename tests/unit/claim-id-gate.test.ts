// Sprint 13 security regression: the invitation id is not a secret. It appears
// in reminder links and in the human's own inbox. Addressing an invitation by
// id must never be enough to tether an agent - the claim token is the proof.
import * as agents from '../../src/services/agents';

jest.mock('../../src/services/db', () => ({
  query: jest.fn(async () => ({ rows: [] })),
  getClient: jest.fn(),
}));

describe('acceptInvitationById claim-token gate', () => {
  const pendingInv = {
    id: '11111111-1111-1111-1111-111111111111',
    agent_id: '22222222-2222-2222-2222-222222222222',
    human_email: 'human@example.com',
    status: 'pending',
    expires_at: new Date(Date.now() + 3600_000),
  };

  it('refuses a claim_link accept with no claim token', async () => {
    await expect(
      agents.acceptInvitationById(pendingInv, { identity_via: 'claim_link' })
    ).rejects.toMatchObject({ code: 'CLAIM_REQUIRED' });
  });

  it('refuses a claim_link accept with a bogus claim token', async () => {
    await expect(
      agents.acceptInvitationById(pendingInv, {
        identity_via: 'claim_link',
        claim_token: 'not-a-real-token-not-a-real-token',
      })
    ).rejects.toMatchObject({ code: 'CLAIM_REQUIRED' });
  });

  it('does not require a claim token on the session path', async () => {
    // The session path is proven by the caller's cookie, checked before this
    // function is reached. It must not throw CLAIM_REQUIRED.
    const err = await agents
      .acceptInvitationById(pendingInv, { identity_via: 'session' })
      .catch((e) => e);
    expect(err?.code).not.toBe('CLAIM_REQUIRED');
  });
});
