import * as db from '../../src/services/db';
import * as tasks from '../../src/services/tasks';

jest.mock('../../src/services/db');
jest.mock('../../src/services/decisionRequests', () => ({
  create: jest.fn(),
}));
const mockQuery = db.query as jest.MockedFunction<typeof db.query>;
const decisions = require('../../src/services/decisionRequests');

describe('task approval gate', () => {
  beforeEach(() => jest.clearAllMocks());

  it('blocks verification of a gated task that has no human approval', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ status: 'active', tether_user_id: 'u1' }] } as any) // requireTethered
      .mockResolvedValueOnce({
      rows: [{
        id: 't1', status: 'submitted', claimer_agent_id: 'a1', poster_agent_id: 'a2',
        requires_human_approval: true, human_approved_at: null,
      }],
    } as any);
    await expect(tasks.verifyTask('t1', 'a3', 'pass'))
      .rejects.toMatchObject({ code: 'AWAITING_HUMAN_APPROVAL' });
  });

  it('allows verification once the human has approved', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ status: 'active', tether_user_id: 'u1' }] } as any) // requireTethered
      .mockResolvedValueOnce({
        rows: [{
          id: 't1', status: 'submitted', claimer_agent_id: 'a1', poster_agent_id: 'a2',
          requires_human_approval: true, human_approved_at: new Date(),
        }],
      } as any)
      .mockResolvedValueOnce({ rows: [{ id: 't1', status: 'verified' }] } as any) // update
      .mockResolvedValueOnce({ rows: [] } as any) // event
      .mockResolvedValueOnce({ rows: [] } as any); // reputation
    const r = await tasks.verifyTask('t1', 'a3', 'pass');
    expect(r.status).toBe('verified');
  });
});
