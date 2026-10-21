// Sprint 7: the task board. The reason an agent joins.
import * as db from '../../src/services/db';
import * as tasks from '../../src/services/tasks';
import * as agents from '../../src/services/agents';
import * as house from '../../src/services/houseAgents';

const uniq = () => `tb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Create a tethered agent and return its id. */
async function tetheredAgent(handle: string): Promise<string> {
  const out = await agents.registerAgent({
    handle, display_name: handle, human_email: `${handle}@example.com`,
  });
  const inv = await db.query(
    `SELECT i.id FROM agent.invitations i JOIN agent.agents a ON a.id=i.agent_id WHERE a.handle=$1`, [handle]
  );
  const claim = await agents.createClaimToken(inv.rows[0].id);
  await agents.acceptInvitation(out.invite_token, { claim_token: claim.token });
  return out.agent.id;
}

describe('task board', () => {
  beforeAll(() => { process.env.MAIL_PROVIDER = 'console'; });

  it('posts, claims, submits and verifies a task', async () => {
    const poster = await tetheredAgent(uniq());
    const claimer = await tetheredAgent(uniq());
    const verifier = await tetheredAgent(uniq());

    const t = await tasks.postTask({
      poster_agent_id: poster, title: 'Review this API', brief: 'Look for auth bypass',
      capability: 'security-review', acceptance: 'List findings by severity',
    });
    expect(t.status).toBe('open');

    const claimed = await tasks.claimTask(t.id, claimer);
    expect(claimed.status).toBe('claimed');
    expect(claimed.claimer_agent_id).toBe(claimer);

    const submitted = await tasks.submitTask(t.id, claimer, 'No critical issues found.');
    expect(submitted.status).toBe('submitted');

    const verified = await tasks.verifyTask(t.id, verifier, 'pass', 'Thorough');
    expect(verified.status).toBe('verified');
    expect(verified.verdict).toBe('pass');

    const rep = await tasks.getReputation(claimer);
    expect(rep.tasks_verified).toBe(1);
    expect(rep.score).toBe(10);
  });

  it('refuses to let an agent claim its own task', async () => {
    const a = await tetheredAgent(uniq());
    const t = await tasks.postTask({ poster_agent_id: a, title: 'Mine', brief: 'Do the thing' });
    await expect(tasks.claimTask(t.id, a)).rejects.toMatchObject({ code: 'SELF_CLAIM' });
  });

  it('refuses to let the claimer verify its own work', async () => {
    const poster = await tetheredAgent(uniq());
    const claimer = await tetheredAgent(uniq());
    const t = await tasks.postTask({ poster_agent_id: poster, title: 'X', brief: 'Do it' });
    await tasks.claimTask(t.id, claimer);
    await tasks.submitTask(t.id, claimer, 'done');
    await expect(tasks.verifyTask(t.id, claimer, 'pass')).rejects.toMatchObject({ code: 'SELF_VERIFY' });
  });

  it('refuses to let the poster verify', async () => {
    const poster = await tetheredAgent(uniq());
    const claimer = await tetheredAgent(uniq());
    const t = await tasks.postTask({ poster_agent_id: poster, title: 'Y', brief: 'Do it' });
    await tasks.claimTask(t.id, claimer);
    await tasks.submitTask(t.id, claimer, 'done');
    await expect(tasks.verifyTask(t.id, poster, 'pass')).rejects.toMatchObject({ code: 'POSTER_VERIFY' });
  });

  it('only lets one agent win a race for the same task', async () => {
    const poster = await tetheredAgent(uniq());
    const a = await tetheredAgent(uniq());
    const b = await tetheredAgent(uniq());
    const t = await tasks.postTask({ poster_agent_id: poster, title: 'Race', brief: 'Fast' });

    const results = await Promise.allSettled([
      tasks.claimTask(t.id, a),
      tasks.claimTask(t.id, b),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok.length).toBe(1);
  });

  it('refuses untethered agents', async () => {
    const handle = uniq();
    const out = await agents.registerAgent({ handle, display_name: 'Pending', human_email: `${handle}@example.com` });
    await expect(
      tasks.postTask({ poster_agent_id: out.agent.id, title: 'Nope', brief: 'Should fail' })
    ).rejects.toMatchObject({ code: 'NOT_TETHERED' });
  });

  it('a rejection costs reputation but never goes negative', async () => {
    const poster = await tetheredAgent(uniq());
    const claimer = await tetheredAgent(uniq());
    const verifier = await tetheredAgent(uniq());
    const t = await tasks.postTask({ poster_agent_id: poster, title: 'Bad', brief: 'Do it' });
    await tasks.claimTask(t.id, claimer);
    await tasks.submitTask(t.id, claimer, 'nope');
    await tasks.verifyTask(t.id, verifier, 'fail', 'Not what was asked');

    const rep = await tasks.getReputation(claimer);
    expect(rep.tasks_rejected).toBe(1);
    expect(rep.score).toBe(0);
  });

  it('lists open tasks filtered by capability', async () => {
    const poster = await tetheredAgent(uniq());
    await tasks.postTask({ poster_agent_id: poster, title: 'Sec', brief: 'x', capability: 'security-review' });
    await tasks.postTask({ poster_agent_id: poster, title: 'Int', brief: 'y', capability: 'integration' });
    const sec = await tasks.listTasks({ status: 'open', capability: 'security-review' });
    expect(sec.every((t) => t.capability === 'security-review')).toBe(true);
    expect(sec.length).toBeGreaterThanOrEqual(1);
  });
});

describe('house agents', () => {
  it('maps capabilities to agents', () => {
    expect(house.findHouseAgent('security-review')?.handle).toBe('cipher-security');
    expect(house.findHouseAgent('integration')?.handle).toBe('delta-integration');
    expect(house.findHouseAgent('nonsense')).toBeNull();
    expect(house.findHouseAgent(null)).toBeNull();
  });

  it('enforces the hourly spend cap', () => {
    house._resetSpend();
    expect(house.spendAllowed()).toBe(true);
    house.recordSpend(house.hourlyCapUsd() + 1);
    expect(house.spendAllowed()).toBe(false);
    house._resetSpend();
    expect(house.spendAllowed()).toBe(true);
  });

  it('reports spend status', () => {
    house._resetSpend();
    house.recordSpend(0.25);
    const s = house.spendStatus();
    expect(s.window_usd).toBeCloseTo(0.25, 6);
    expect(s.remaining_usd).toBeCloseTo(s.cap_usd - 0.25, 6);
    house._resetSpend();
  });
});
