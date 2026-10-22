// Sprint 11.3 — verified work moves ownership, behind a gate.
//
// Every agent shares one operator, so "a third agent verified it" is not
// independence. These tests pin the three defences and the cap.
import * as db from '../../src/services/db';
import * as contributions from '../../src/services/contributions';

jest.mock('../../src/services/db', () => ({ query: jest.fn(), getClient: jest.fn() }));
const mockQuery = db.query as jest.Mock;
const mockGetClient = db.getClient as jest.Mock;

const TASK = {
  id: 'task-1', conversation_id: 'conv-1', status: 'verified', verdict: 'pass',
  claimer_agent_id: 'ag-claimer', verifier_agent_id: 'ag-verifier',
  claimer_avatar: 'av-claimer', claimer_human: 'human-a', verifier_human: 'human-b',
};

function taskRow(over: any = {}) {
  return { rows: [{ ...TASK, ...over }] };
}

beforeEach(() => { mockQuery.mockReset(); mockGetClient.mockReset(); });

describe('gate', () => {
  it('refuses when verifier shares a tethering human with the claimer', async () => {
    mockQuery
      .mockResolvedValueOnce(taskRow({ verifier_human: 'human-a' }))  // task
      .mockResolvedValueOnce({ rows: [] })                            // existing check
      .mockResolvedValueOnce({ rows: [] });                           // refuse insert
    const r = await contributions.recordContribution('task-1');
    expect(r.status).toBe('refused');
    expect(r.reason).toContain('SAME_OPERATOR');
  });

  it('refuses an inexperienced verifier', async () => {
    mockQuery
      .mockResolvedValueOnce(taskRow())
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ verifications_given: 1, score: 2 }] })
      .mockResolvedValueOnce({ rows: [] });
    const r = await contributions.recordContribution('task-1');
    expect(r.reason).toContain('VERIFIER_INEXPERIENCED');
  });

  it('refuses a verifier with negative reputation', async () => {
    mockQuery
      .mockResolvedValueOnce(taskRow())
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ verifications_given: 10, score: -4 }] })
      .mockResolvedValueOnce({ rows: [] });
    const r = await contributions.recordContribution('task-1');
    expect(r.reason).toContain('VERIFIER_LOW_SCORE');
  });

  it('relaxes the threshold to 1 when the project is bootstrapping', async () => {
    const client = { query: jest.fn(async (sql: string) => {
      if (sql.includes('SELECT * FROM mojomo.conversations')) return { rows: [{ id: 'conv-1', status: 'active', total_tokens: 1000,
        ownership_ledger: { 'av-a': { ownership_pct: 50, join_round: 0 }, 'av-b': { ownership_pct: 50, join_round: 0 } },
        initiator_avatar_id: 'av-a', target_avatar_id: 'av-b' }] };
      return { rows: [] };
    }), release: jest.fn() };
    mockGetClient.mockResolvedValue(client);
    mockQuery
      .mockResolvedValueOnce(taskRow({ bootstrap_contributions: true }))
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ verifications_given: 1, score: 2 }] });
    const r = await contributions.recordContribution('task-1');
    expect(r.status).toBe('credited');
  });

  it('still refuses same-operator verification even when bootstrapping', async () => {
    mockQuery
      .mockResolvedValueOnce(taskRow({ bootstrap_contributions: true, verifier_human: 'human-a' }))
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const r = await contributions.recordContribution('task-1');
    expect(r.reason).toContain('SAME_OPERATOR');
  });

  it('refuses a task not attached to a project', async () => {
    mockQuery.mockResolvedValueOnce(taskRow({ conversation_id: null }));
    await expect(contributions.recordContribution('task-1'))
      .rejects.toMatchObject({ code: 'NO_PROJECT' });
  });

  it('refuses a task that did not pass verification', async () => {
    mockQuery.mockResolvedValueOnce(taskRow({ verdict: 'fail', status: 'rejected' }));
    await expect(contributions.recordContribution('task-1'))
      .rejects.toMatchObject({ code: 'NOT_VERIFIED' });
  });

  it('refuses a task that already contributed', async () => {
    mockQuery
      .mockResolvedValueOnce(taskRow())
      .mockResolvedValueOnce({ rows: [{ id: 'existing' }] });
    await expect(contributions.recordContribution('task-1'))
      .rejects.toMatchObject({ code: 'ALREADY_RECORDED' });
  });
});

describe('ownership move', () => {
  function clientWith(ledger: any, totalTokens = 1000, status = 'active') {
    const q = jest.fn(async (sql: string) => {
      if (sql.includes('SELECT * FROM mojomo.conversations')) {
        return { rows: [{ id: 'conv-1', status, total_tokens: totalTokens, ownership_ledger: ledger,
          initiator_avatar_id: 'av-a', target_avatar_id: 'av-b' }] };
      }
      return { rows: [] };
    });
    return { query: q, release: jest.fn() };
  }

  const GENESIS = {
    'av-a': { ownership_pct: 50, token_balance: 500, join_round: 0 },
    'av-b': { ownership_pct: 50, token_balance: 500, join_round: 0 },
  };

  it('extracts from both founders and keeps the ledger at 100%', async () => {
    const client = clientWith(GENESIS);
    mockGetClient.mockResolvedValue(client);
    mockQuery
      .mockResolvedValueOnce(taskRow())
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ verifications_given: 5, score: 12 }] });

    const r = await contributions.recordContribution('task-1');
    expect(r.status).toBe('credited');
    expect(r.ownership_pct).toBeCloseTo(5, 2); // 5% of 50 + 5% of 50

    const update = client.query.mock.calls.find((c: any) => String(c[0]).includes('UPDATE mojomo.conversations')) as any;
    const ledger = JSON.parse(update[1][0]);
    const sum = Object.values(ledger).reduce((a: number, o: any) => a + o.ownership_pct, 0);
    expect(sum).toBeCloseTo(100, 2);
    expect(ledger['av-claimer'].ownership_pct).toBeCloseTo(5, 2);
  });

  it('refuses once the contribution cap is reached', async () => {
    const capped: any = { ...GENESIS };
    for (let i = 1; i <= contributions.MAX_CONTRIBUTION_ROUNDS; i++) {
      capped[`av-x${i}`] = { ownership_pct: 1, join_round: i };
    }
    const client = clientWith(capped);
    mockGetClient.mockResolvedValue(client);
    mockQuery
      .mockResolvedValueOnce(taskRow())
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ verifications_given: 5, score: 12 }] })
      .mockResolvedValueOnce({ rows: [] });
    const r = await contributions.recordContribution('task-1');
    expect(r.reason).toContain('CONTRIBUTION_CAP_REACHED');
  });

  it('refuses a project with no genesis pair', async () => {
    const client = clientWith({ 'av-a': { ownership_pct: 100, join_round: 0 } });
    mockGetClient.mockResolvedValue(client);
    mockQuery
      .mockResolvedValueOnce(taskRow())
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ verifications_given: 5, score: 12 }] })
      .mockResolvedValueOnce({ rows: [] });
    const r = await contributions.recordContribution('task-1');
    expect(r.reason).toContain('NO_GENESIS_PAIR');
  });
});
