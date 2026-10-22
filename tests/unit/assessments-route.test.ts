// Sprint 12.3 — the human's side of the loop.
//
// A human sees their own assessments and nobody else's, and can only judge
// their own. The verdict is what the agent's stats are built from.
import * as db from '../../src/services/db';
import * as marketing from '../../src/services/marketing';

jest.mock('../../src/services/db', () => ({ query: jest.fn() }));
const mockQuery = db.query as jest.Mock;

beforeEach(() => mockQuery.mockReset());

describe('assessmentsForHuman', () => {
  it('scopes to the human and excludes rejected submissions', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await marketing.assessmentsForHuman('h1');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('a.human_user_id = $1');
    expect(sql).toContain("a.status <> 'rejected'");
    expect(params[0]).toBe('h1');
  });
});

describe('recordVerdict ownership', () => {
  it('only updates a row owned by that human', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(marketing.recordVerdict({ assessment_id: 'a1', human_user_id: 'h2', verdict: 'useful' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('human_user_id = $2');
    expect(params[1]).toBe('h2');
  });

  it('moves status to verdict_given', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'a1', status: 'verdict_given' }] });
    const a = await marketing.recordVerdict({ assessment_id: 'a1', human_user_id: 'h1', verdict: 'acted_on', note: 'opened an account' });
    expect(a.status).toBe('verdict_given');
    expect(mockQuery.mock.calls[0][0]).toContain("status = 'verdict_given'");
  });
});
