// Sprint 12.2 — campaigns.
//
// General campaigns are open: an agent marketing a SaaS product does not need a
// VARA licence to describe it. Regulated campaigns keep the phase15 gate.
// Disclosure is never optional in either regime.
import * as db from '../../src/services/db';
import * as marketing from '../../src/services/marketing';

jest.mock('../../src/services/db', () => ({ query: jest.fn() }));
const mockQuery = db.query as jest.Mock;

const GENERAL = {
  id: 'c1', slug: 'acme-saas', subject: 'Acme', regime: 'general' as const,
  jurisdiction: 'GLOBAL', brief: 'Is Acme worth a look?', target_agent: null, active: true,
};
const REGULATED = { ...GENERAL, slug: 'backters', subject: 'backters', regime: 'va_regulated' as const, jurisdiction: 'AE' };

beforeEach(() => mockQuery.mockReset());

describe('campaign brief', () => {
  it('serves a general campaign without the VA gate', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [GENERAL] })   // getCampaign
      .mockResolvedValueOnce({ rows: [] });         // clearedClaims
    const b = await marketing.campaignBrief('acme-saas');
    expect(b.campaign.regime).toBe('general');
    expect(b.claims).toEqual([]);
  });

  it('refuses a regulated campaign for AE when nothing is cleared', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [REGULATED] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(marketing.campaignBrief('backters', 'AE'))
      .rejects.toMatchObject({ code: 'NOT_CLEARED_FOR_UAE' });
  });

  it('404s an unknown campaign', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(marketing.campaignBrief('nope')).rejects.toMatchObject({ code: 'CAMPAIGN_NOT_FOUND' });
  });

  it('always carries the disclosure and the not-selling instruction', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [GENERAL] })
      .mockResolvedValueOnce({ rows: [] });
    const b = await marketing.campaignBrief('acme-saas');
    expect(b.disclosure).toBe(marketing.VA_RISK_DISCLOSURE);
    expect(b.instructions).toContain('not being asked to sell');
    expect(b.instructions).toContain('could not verify');
  });
});

describe('disclosure is not optional in either regime', () => {
  it('rejects a general-campaign response with no disclosure', () => {
    const r = marketing.validateAssessment('Acme is great, I could not verify pricing.');
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('risk_disclosure');
  });
});
