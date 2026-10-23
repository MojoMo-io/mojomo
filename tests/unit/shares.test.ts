// Sprint 11 — unified shares.
//
// One table for every kind of share. The tests that matter are the ones that
// stop a share being recorded against something that does not exist, and the
// ones that keep the two subject shapes (platform vs. everything else) from
// bleeding into each other.
import * as db from '../../src/services/db';
import * as shares from '../../src/services/shares';

jest.mock('../../src/services/db', () => ({ query: jest.fn() }));
const mockQuery = db.query as jest.Mock;

const AGENT = '11111111-1111-1111-1111-111111111111';
const OFFER = '22222222-2222-2222-2222-222222222222';
const CAMPAIGN = '33333333-3333-3333-3333-333333333333';
const CODE_ROW = { id: 'c0de', agent_id: AGENT, code: 'abcd2345', label: null, created_at: new Date() };

beforeEach(() => mockQuery.mockReset());

describe('recordShare', () => {
  it('records a platform share with no subject id', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [CODE_ROW] })   // getOrCreateCode: existing
      .mockResolvedValueOnce({ rows: [{ id: '77' }] }); // insert
    const r = await shares.recordShare({ agentId: AGENT, subjectType: 'platform' });
    expect(r.subject_id).toBeNull();
    expect(r.url).toBe('https://mojomo.io/?ref=abcd2345');
    expect(r.code).toBe('abcd2345');
  });

  it('carries the subject in the URL for an offer share', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: OFFER }] })  // offer exists
      .mockResolvedValueOnce({ rows: [CODE_ROW] })       // code
      .mockResolvedValueOnce({ rows: [{ id: '78' }] });  // insert
    const r = await shares.recordShare({ agentId: AGENT, subjectType: 'offer', subjectId: OFFER });
    expect(r.url).toContain(`subject=offer%3A${OFFER}`);
    expect(r.subject_id).toBe(OFFER);
  });

  it('refuses an offer share when the offer does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(
      shares.recordShare({ agentId: AGENT, subjectType: 'offer', subjectId: OFFER })
    ).rejects.toMatchObject({ code: 'OFFER_NOT_FOUND' });
  });

  it('refuses a campaign share when the campaign does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(
      shares.recordShare({ agentId: AGENT, subjectType: 'campaign', subjectId: CAMPAIGN })
    ).rejects.toMatchObject({ code: 'CAMPAIGN_NOT_FOUND' });
  });

  it('requires a subject id for anything that is not the platform', async () => {
    await expect(
      shares.recordShare({ agentId: AGENT, subjectType: 'offer' })
    ).rejects.toMatchObject({ code: 'SUBJECT_REQUIRED' });
  });

  it('rejects an unknown subject type', async () => {
    await expect(
      shares.recordShare({ agentId: AGENT, subjectType: 'nonsense' as any })
    ).rejects.toMatchObject({ code: 'BAD_SUBJECT' });
  });

  it('rejects an unknown audience', async () => {
    await expect(
      shares.recordShare({ agentId: AGENT, subjectType: 'platform', audience: 'aliens' as any })
    ).rejects.toMatchObject({ code: 'BAD_AUDIENCE' });
  });

  it('writes the sharing agent, not the code id, into agent_id', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [CODE_ROW] })
      .mockResolvedValueOnce({ rows: [{ id: '79' }] });
    await shares.recordShare({ agentId: AGENT, subjectType: 'platform' });
    const insertArgs = mockQuery.mock.calls[1][1];
    expect(insertArgs[0]).toBe(AGENT);
    expect(insertArgs[3]).toBe(CODE_ROW.id);
  });
});

describe('recordArrival', () => {
  it('ignores a malformed code rather than throwing', async () => {
    await shares.recordArrival({ code: 'no!' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('records an arrival against the code', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'c0de' }] })
      .mockResolvedValueOnce({ rows: [] });
    await shares.recordArrival({ code: 'abcd2345', surface: 'landing' });
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[1][1][1]).toBe('abcd2345');
  });
});

describe('shareStats', () => {
  it('returns empty stats when the agent has never shared', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const s = await shares.shareStats(AGENT);
    expect(s).toEqual({ code: null, shares: 0, arrivals: 0, by_audience: {}, by_subject: {} });
  });

  it('counts shares by audience and subject', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ code: 'abcd2345' }] })
      .mockResolvedValueOnce({ rows: [
        { audience: 'human', subject_type: 'platform', n: 2 },
        { audience: 'agent', subject_type: 'offer', n: 1 },
      ] })
      .mockResolvedValueOnce({ rows: [{ n: 3 }] });
    const s = await shares.shareStats(AGENT);
    expect(s.shares).toBe(3);
    expect(s.arrivals).toBe(3);
    expect(s.by_audience).toEqual({ human: 2, agent: 1 });
    expect(s.by_subject).toEqual({ platform: 2, offer: 1 });
  });
});
