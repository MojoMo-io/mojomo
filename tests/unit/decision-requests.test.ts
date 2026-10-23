import * as db from '../../src/services/db';
import * as decisions from '../../src/services/decisionRequests';

jest.mock('../../src/services/db');
const mockQuery = db.query as jest.MockedFunction<typeof db.query>;

const agentRow = { id: 'agent-1', status: 'active', tether_user_id: 'user-1', display_name: 'Echo', handle: 'echo' };

describe('decisionRequests.create', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuses an agent that is not tethered', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...agentRow, status: 'pending', tether_user_id: null }] } as any);
    await expect(decisions.create({ agentId: 'agent-1', kind: 'approve', title: 'Spend?' }))
      .rejects.toMatchObject({ code: 'NOT_TETHERED' });
  });

  it('defaults approve to yes/no options', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [agentRow] } as any)          // agent
      .mockResolvedValueOnce({ rows: [{ n: 0 }] } as any)          // open count
      .mockResolvedValueOnce({ rows: [{ n: 0 }] } as any)          // day count
      .mockResolvedValueOnce({ rows: [{ id: 'req-1', options: [{ id: 'yes', label: 'Approve' }, { id: 'no', label: 'Decline' }] }] } as any);
    const r = await decisions.create({ agentId: 'agent-1', kind: 'approve', title: 'Spend?' });
    expect(r.options.map((o: any) => o.id)).toEqual(['yes', 'no']);
  });

  it('rejects a choose with fewer than two options', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [agentRow] } as any);
    await expect(decisions.create({
      agentId: 'agent-1', kind: 'choose', title: 'Pick', options: [{ id: 'a', label: 'A' }],
    })).rejects.toMatchObject({ code: 'BAD_OPTIONS' });
  });

  it('enforces the pending cap', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [agentRow] } as any)
      .mockResolvedValueOnce({ rows: [{ n: decisions.MAX_PENDING_PER_AGENT }] } as any);
    await expect(decisions.create({ agentId: 'agent-1', kind: 'approve', title: 'x' }))
      .rejects.toMatchObject({ code: 'TOO_MANY_PENDING' });
  });
});

describe('decisionRequests.answer', () => {
  beforeEach(() => jest.clearAllMocks());

  const pending = {
    id: 'req-1', tether_user_id: 'user-1', status: 'pending',
    expires_at: new Date(Date.now() + 3600_000),
    options: [{ id: 'yes', label: 'Approve' }, { id: 'no', label: 'Decline' }],
  };

  it('refuses an answer from someone else', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [pending] } as any);
    await expect(decisions.answer({ id: 'req-1', userId: 'user-2', answer: 'yes' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses an answer that is not one of the options', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [pending] } as any);
    await expect(decisions.answer({ id: 'req-1', userId: 'user-1', answer: 'maybe' }))
      .rejects.toMatchObject({ code: 'BAD_ANSWER' });
  });

  it('refuses an expired request', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...pending, expires_at: new Date(Date.now() - 1000) }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any);
    await expect(decisions.answer({ id: 'req-1', userId: 'user-1', answer: 'yes' }))
      .rejects.toMatchObject({ code: 'EXPIRED' });
  });

  it('accepts a valid answer', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({})                                                   // BEGIN
        .mockResolvedValueOnce({ rows: [{ ...pending, status: 'answered', answer: 'yes' }] }) // UPDATE
        .mockResolvedValueOnce({}),                                                  // COMMIT
      release: jest.fn(),
    };
    (db.getClient as jest.Mock).mockResolvedValueOnce(client);
    mockQuery.mockResolvedValueOnce({ rows: [pending] } as any);
    const r = await decisions.answer({ id: 'req-1', userId: 'user-1', answer: 'yes' });
    expect(r.status).toBe('answered');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  it('rolls back if the task update fails', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({})                                                   // BEGIN
        .mockResolvedValueOnce({ rows: [{ ...pending, status: 'answered', answer: 'yes', task_id: 't1' }] }) // UPDATE
        .mockRejectedValueOnce(new Error('boom'))                                    // task update
        .mockResolvedValueOnce({}),                                                  // ROLLBACK
      release: jest.fn(),
    };
    (db.getClient as jest.Mock).mockResolvedValueOnce(client);
    mockQuery.mockResolvedValueOnce({ rows: [pending] } as any);
    await expect(decisions.answer({ id: 'req-1', userId: 'user-1', answer: 'yes' })).rejects.toThrow('boom');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});
