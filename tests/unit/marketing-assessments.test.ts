// Sprint 12.3 — the assessment loop.
//
// The agent submits, the server validates before the human sees it, the human
// says whether it was useful. The verdict is the only signal that tells us
// whether the agent's judgement was worth anything.
import * as db from '../../src/services/db';
import * as marketing from '../../src/services/marketing';

jest.mock('../../src/services/db', () => ({ query: jest.fn() }));
const mockQuery = db.query as jest.Mock;

const CAMPAIGN = {
  id: 'camp-1', slug: 'backters', subject: 'Backters', regime: 'general' as const,
  jurisdiction: 'GLOBAL', brief: 'Assess it.', target_agent: null, active: true,
};

const GOOD = `Backters advertises 144% over 3 years after a 90-day lock. ` +
  `I could not verify the bond counterparty or the issuer's licence status. ` +
  marketing.VA_RISK_DISCLOSURE;

beforeEach(() => mockQuery.mockReset());

describe('submitAssessment', () => {
  it('accepts a compliant assessment', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [CAMPAIGN] })
      .mockResolvedValueOnce({ rows: [{ id: 'a1', status: 'submitted' }] });
    const r = await marketing.submitAssessment({ campaign_slug: 'backters', agent_id: 'ag1', body: GOOD });
    expect(r.accepted).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it('rejects and stores a non-compliant assessment rather than discarding it', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [CAMPAIGN] })
      .mockResolvedValueOnce({ rows: [{ id: 'a2', status: 'rejected' }] });
    const r = await marketing.submitAssessment({ campaign_slug: 'backters', agent_id: 'ag1', body: 'Backters pays 144%, looks good.' });
    expect(r.accepted).toBe(false);
    expect(r.missing).toContain('risk_disclosure');
    // stored, not thrown away — a repeatedly-failing agent is a signal
    expect(mockQuery.mock.calls[1][1][8]).toBe('rejected');
  });

  it('404s an unknown campaign', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(marketing.submitAssessment({ campaign_slug: 'nope', agent_id: 'ag1', body: GOOD }))
      .rejects.toMatchObject({ code: 'CAMPAIGN_NOT_FOUND' });
  });
});

describe('recordVerdict', () => {
  it('records a verdict for the owning human', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'a1', human_verdict: 'useful' }] });
    const a = await marketing.recordVerdict({ assessment_id: 'a1', human_user_id: 'h1', verdict: 'useful' });
    expect(a.human_verdict).toBe('useful');
  });

  it('refuses a verdict from someone who does not own the assessment', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(marketing.recordVerdict({ assessment_id: 'a1', human_user_id: 'h2', verdict: 'useful' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('agentAssessmentStats', () => {
  it('reports verdict counts, not a score', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ submitted: 4, judged: 3, useful: 2, not_useful: 1, acted_on: 0 }] });
    const s = await marketing.agentAssessmentStats('ag1');
    expect(s).toEqual({ submitted: 4, judged: 3, useful: 2, not_useful: 1, acted_on: 0 });
  });
});
