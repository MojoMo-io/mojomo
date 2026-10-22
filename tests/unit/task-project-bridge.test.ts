// Sprint 11.2 — a task can belong to a project.
//
// The premise of the platform is that agents and their humans form teams around
// a project and accrue ownership in what it becomes. That only works if a task
// can be attached to a conversation, so verified work can later be recorded as a
// contribution against that project's ownership ledger.
//
// These tests pin the bridge itself: the column exists, postTask carries it,
// listTasks can filter by it, and a standalone task still works.
import * as db from '../../src/services/db';
import * as tasks from '../../src/services/tasks';

jest.mock('../../src/services/db', () => ({ query: jest.fn() }));

const mockQuery = db.query as jest.Mock;

const POSTER = '11111111-1111-1111-1111-111111111111';
const PROJECT = '22222222-2222-2222-2222-222222222222';

function tetherOk() {
  // requireTethered looks up the agent; return an active, tethered row.
  return { rows: [{ id: POSTER, status: 'active', tether_user_id: 'u1' }] };
}

beforeEach(() => mockQuery.mockReset());

describe('task <-> project bridge', () => {
  it('postTask persists conversation_id when given a project', async () => {
    mockQuery
      .mockResolvedValueOnce(tetherOk())                       // requireTethered
      .mockResolvedValueOnce({ rows: [{ id: 'task-1', conversation_id: PROJECT }] }) // INSERT
      .mockResolvedValueOnce({ rows: [] })                     // task_events
      .mockResolvedValueOnce({ rows: [] });                    // recomputeReputation

    const t = await tasks.postTask({
      poster_agent_id: POSTER,
      title: 'A real task',
      brief: 'A brief long enough to be plausible.',
      conversation_id: PROJECT,
    });

    const insert = mockQuery.mock.calls[1];
    expect(insert[0]).toContain('conversation_id');
    expect(insert[1]).toContain(PROJECT);
    expect(t.conversation_id).toBe(PROJECT);
  });

  it('postTask leaves conversation_id null for a standalone gig', async () => {
    mockQuery
      .mockResolvedValueOnce(tetherOk())
      .mockResolvedValueOnce({ rows: [{ id: 'task-2', conversation_id: null }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const t = await tasks.postTask({
      poster_agent_id: POSTER,
      title: 'Standalone',
      brief: 'Still a valid way to use the board.',
    });

    expect(mockQuery.mock.calls[1][1][7]).toBeNull();
    expect(t.conversation_id).toBeNull();
  });

  it('listTasks filters by project when asked', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await tasks.listTasks({ status: 'open', conversationId: PROJECT });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('conversation_id =');
    expect(params).toContain(PROJECT);
  });

  it('listTasks does not filter by project when not asked', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await tasks.listTasks({ status: 'open' });
    expect(mockQuery.mock.calls[0][0]).not.toContain('conversation_id =');
  });
});
