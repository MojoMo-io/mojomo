// Sprint 4: funnel instrumentation. Every stage of an invitation's life is
// recorded, and one query answers "where are we losing people?".
import * as db from '../../src/services/db';
import * as funnel from '../../src/services/funnel';
import * as agents from '../../src/services/agents';

const uniq = () => `funnel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function stagesFor(invitationId: string): Promise<string[]> {
  const r = await db.query(
    `SELECT stage FROM agent.funnel_events WHERE invitation_id=$1 ORDER BY id`,
    [invitationId]
  );
  return r.rows.map((x: any) => x.stage);
}

async function invitationIdFor(handle: string): Promise<string> {
  const r = await db.query(
    `SELECT i.id FROM agent.invitations i JOIN agent.agents a ON a.id=i.agent_id WHERE a.handle=$1`,
    [handle]
  );
  return r.rows[0].id;
}

describe('funnel', () => {
  beforeAll(() => { process.env.MAIL_PROVIDER = 'console'; });

  it('records registered + email_sent on registration', async () => {
    const handle = uniq();
    const out = await agents.registerAgent({
      handle, display_name: 'Funnel Test', human_email: `${handle}@example.com`,
      description: 'tests the funnel',
    });
    const invId = await invitationIdFor(handle);
    const stages = await stagesFor(invId);
    expect(stages).toEqual(['registered', 'email_sent']);

    const row = await db.query(
      `SELECT handle, agent_id, detail FROM agent.funnel_events
        WHERE invitation_id=$1 AND stage='registered'`,
      [invId]
    );
    expect(row.rows[0].handle).toBe(handle);
    expect(row.rows[0].agent_id).toBe(out.agent.id);
    expect(row.rows[0].detail.email_sent).toBe(true);
  });

  it('records email_failed when delivery fails', async () => {
    process.env.MAIL_PROVIDER = 'smtp';
    process.env.SMTP_URL = 'smtp://127.0.0.1:1';
    const handle = uniq();
    await agents.registerAgent({
      handle, display_name: 'Funnel Fail', human_email: `${handle}@example.com`,
    });
    const invId = await invitationIdFor(handle);
    const stages = await stagesFor(invId);
    expect(stages).toContain('email_failed');
    expect(stages).not.toContain('email_sent');
    process.env.MAIL_PROVIDER = 'console';
  }, 20000);

  it('records accepted with the via channel', async () => {
    const handle = uniq();
    const out = await agents.registerAgent({
      handle, display_name: 'Funnel Accept', human_email: `${handle}@example.com`,
    });
    await agents.acceptInvitation(out.invite_token, { via: 'email', ip: '203.0.113.7' });
    const invId = await invitationIdFor(handle);
    const stages = await stagesFor(invId);
    expect(stages).toEqual(['registered', 'email_sent', 'accepted']);

    const row = await db.query(
      `SELECT detail FROM agent.funnel_events WHERE invitation_id=$1 AND stage='accepted'`,
      [invId]
    );
    expect(row.rows[0].detail.via).toBe('email');
  });

  it('records declined with the reason', async () => {
    const handle = uniq();
    const out = await agents.registerAgent({
      handle, display_name: 'Funnel Decline', human_email: `${handle}@example.com`,
    });
    await agents.declineInvitation(out.invite_token, { reason: 'not my agent' });
    const invId = await invitationIdFor(handle);
    const stages = await stagesFor(invId);
    expect(stages).toEqual(['registered', 'email_sent', 'declined']);

    const row = await db.query(
      `SELECT detail FROM agent.funnel_events WHERE invitation_id=$1 AND stage='declined'`,
      [invId]
    );
    expect(row.rows[0].detail.reason).toBe('not my agent');
  });

  it('records expired when an expired invite is claimed', async () => {
    const handle = uniq();
    const out = await agents.registerAgent({
      handle, display_name: 'Funnel Expire', human_email: `${handle}@example.com`,
    });
    const invId = await invitationIdFor(handle);
    await db.query(`UPDATE agent.invitations SET expires_at = now() - interval '1 hour' WHERE id=$1`, [invId]);

    await expect(agents.acceptInvitation(out.invite_token, {})).rejects.toMatchObject({ code: 'EXPIRED' });
    const stages = await stagesFor(invId);
    expect(stages).toContain('expired');
    expect(stages).not.toContain('accepted');
  });

  it('never throws when the funnel write fails', async () => {
    const spy = jest.spyOn(db, 'query').mockRejectedValueOnce(new Error('db down'));
    await expect(funnel.emit('registered', { handle: 'x' })).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it('report counts distinct invitations, not raw events', async () => {
    const handle = uniq();
    const out = await agents.registerAgent({
      handle, display_name: 'Funnel Report', human_email: `${handle}@example.com`,
    });
    const invId = await invitationIdFor(handle);
    // Three opens of the same invitation must not inflate the stage.
    for (let i = 0; i < 3; i++) {
      await funnel.emit('invite_opened', { invitation_id: invId, handle });
    }
    const from = new Date(Date.now() - 3600_000);
    const to = new Date(Date.now() + 3600_000);
    const r = await funnel.report(from, to);
    expect(r.counts.invite_opened).toBeGreaterThanOrEqual(3);
    expect(r.unique.invite_opened).toBeGreaterThanOrEqual(1);
    expect(r.unique.invite_opened).toBeLessThan(r.counts.invite_opened);
    expect(r.conversion.map((c) => c.to)).toEqual(['email_sent', 'invite_opened', 'accepted']);
    expect(r.biggest_drop).not.toBeNull();
  });

  it('report returns null rates when there is no data', async () => {
    const from = new Date('2000-01-01T00:00:00Z');
    const to = new Date('2000-01-02T00:00:00Z');
    const r = await funnel.report(from, to);
    expect(r.unique.registered).toBe(0);
    expect(r.conversion.every((c) => c.rate === null)).toBe(true);
    expect(r.biggest_drop).toBeNull();
  });
});
