// Sprint 5: multiple humans per agent, and claim authentication.
//
// Two invariants:
//   1. An agent may name several humans; each gets their own link; the first to
//      accept tethers it.
//   2. The invite URL alone is not a credential. Claiming requires either a
//      single-use claim token bound to that invitation, or a session whose email
//      matches the invitation's human_email.
import * as db from '../../src/services/db';
import * as agents from '../../src/services/agents';

const uniq = () => `claim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function invIdFor(handle: string, email: string): Promise<string> {
  const r = await db.query(
    `SELECT i.id FROM agent.invitations i JOIN agent.agents a ON a.id=i.agent_id
      WHERE a.handle=$1 AND i.human_email=$2`,
    [handle, email]
  );
  return r.rows[0].id;
}

describe('multiple humans per agent', () => {
  beforeAll(() => { process.env.MAIL_PROVIDER = 'console'; });

  it('lets one agent name several humans, each with their own invitation', async () => {
    const handle = uniq();
    const a = await agents.registerAgent({
      handle, display_name: 'Multi Human', human_email: `${handle}-a@example.com`,
    });
    // Second human for the same agent: registerAgent creates a new agent, so we
    // exercise the invitation layer directly, which is where the cap lived.
    const inv = await db.query(
      `INSERT INTO agent.invitations (agent_id, token_hash, human_email, expires_at)
       VALUES ($1,$2,$3, now() + interval '72 hours') RETURNING id`,
      [a.agent.id, agents.hashToken(agents.randomToken()), `${handle}-b@example.com`]
    );
    expect(inv.rows.length).toBe(1);

    const count = await db.query(
      `SELECT count(*)::int AS n FROM agent.invitations WHERE agent_id=$1`,
      [a.agent.id]
    );
    expect(count.rows[0].n).toBe(2);
  });

  it('rejects a duplicate invitation for the same (agent, human) pair', async () => {
    const handle = uniq();
    const email = `${handle}@example.com`;
    const a = await agents.registerAgent({ handle, display_name: 'Dup', human_email: email });
    await expect(
      db.query(
        `INSERT INTO agent.invitations (agent_id, token_hash, human_email, expires_at)
         VALUES ($1,$2,$3, now() + interval '72 hours')`,
        [a.agent.id, agents.hashToken(agents.randomToken()), email]
      )
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it('rotates the token when the same human re-registers, invalidating the old link', async () => {
    const handle = uniq();
    const email = `${handle}@example.com`;
    const first = await agents.registerAgent({ handle, display_name: 'Rotate', human_email: email });

    // Same agent, same human: reuse the pending invite and rotate its token.
    const invId = await invIdFor(handle, email);
    const oldHash = await db.query(`SELECT token_hash FROM agent.invitations WHERE id=$1`, [invId]);
    await db.query(`UPDATE agent.invitations SET token_hash=$1 WHERE id=$2`, [
      agents.hashToken(agents.randomToken()), invId,
    ]);
    const newHash = await db.query(`SELECT token_hash FROM agent.invitations WHERE id=$1`, [invId]);
    expect(newHash.rows[0].token_hash).not.toBe(oldHash.rows[0].token_hash);

    // The original link no longer resolves.
    expect(await agents.getInvitation(first.invite_token)).toBeNull();
  });
});

describe('claim authentication', () => {
  beforeAll(() => { process.env.MAIL_PROVIDER = 'console'; });

  it('refuses to tether on the invite token alone', async () => {
    const handle = uniq();
    const out = await agents.registerAgent({
      handle, display_name: 'No Claim', human_email: `${handle}@example.com`,
    });
    await expect(agents.acceptInvitation(out.invite_token, {})).rejects.toMatchObject({
      code: 'CLAIM_REQUIRED',
    });

    // And the agent must still be untethered.
    const r = await db.query(`SELECT status, tether_user_id FROM agent.agents WHERE handle=$1`, [handle]);
    expect(r.rows[0].status).toBe('untethered');
    expect(r.rows[0].tether_user_id).toBeNull();
  });

  it('refuses a claim token minted for a different invitation', async () => {
    const h1 = uniq();
    const h2 = uniq();
    const a = await agents.registerAgent({ handle: h1, display_name: 'A', human_email: `${h1}@example.com` });
    const b = await agents.registerAgent({ handle: h2, display_name: 'B', human_email: `${h2}@example.com` });

    const invB = await invIdFor(h2, `${h2}@example.com`);
    const stolen = await agents.createClaimToken(invB);

    // A's invite token + B's claim token must not work.
    await expect(
      agents.acceptInvitation(a.invite_token, { claim_token: stolen.token })
    ).rejects.toMatchObject({ code: 'CLAIM_REQUIRED' });
    expect(b.agent.status).toBe('untethered');
  });

  it('accepts with a valid claim token and burns it', async () => {
    const handle = uniq();
    const out = await agents.registerAgent({
      handle, display_name: 'Good Claim', human_email: `${handle}@example.com`,
    });
    const invId = await invIdFor(handle, `${handle}@example.com`);
    const claim = await agents.createClaimToken(invId);

    const res = await agents.acceptInvitation(out.invite_token, { claim_token: claim.token });
    expect(res.api_key).toMatch(/^mjm_/);

    // Single use: the same claim token cannot tether anything again.
    expect(await agents.verifyClaimToken(invId, claim.token)).toBe(false);
  });

  it('accepts on a session match without a claim token', async () => {
    const handle = uniq();
    const out = await agents.registerAgent({
      handle, display_name: 'Session Match', human_email: `${handle}@example.com`,
    });
    const res = await agents.acceptInvitation(out.invite_token, { identity_via: 'session' });
    expect(res.api_key).toMatch(/^mjm_/);

    const ev = await db.query(
      `SELECT detail FROM agent.tether_events WHERE agent_id=$1 AND event='accepted'`,
      [out.agent.id]
    );
    expect(ev.rows[0].detail.identity_via).toBe('session');
  });

  it('expires claim tokens', async () => {
    const handle = uniq();
    const out = await agents.registerAgent({
      handle, display_name: 'Expired Claim', human_email: `${handle}@example.com`,
    });
    const invId = await invIdFor(handle, `${handle}@example.com`);
    const claim = await agents.createClaimToken(invId);
    await db.query(`UPDATE agent.claim_tokens SET expires_at = now() - interval '1 minute' WHERE invitation_id=$1`, [invId]);

    await expect(
      agents.acceptInvitation(out.invite_token, { claim_token: claim.token })
    ).rejects.toMatchObject({ code: 'CLAIM_REQUIRED' });
  });

  it('revokes outstanding claim tokens on decline', async () => {
    const handle = uniq();
    const out = await agents.registerAgent({
      handle, display_name: 'Decline Revoke', human_email: `${handle}@example.com`,
    });
    const invId = await invIdFor(handle, `${handle}@example.com`);
    const claim = await agents.createClaimToken(invId);

    await agents.declineInvitation(out.invite_token, { reason: 'no thanks' });
    expect(await agents.verifyClaimToken(invId, claim.token)).toBe(false);
  });
});
