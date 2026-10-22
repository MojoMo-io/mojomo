// Sprint 12 — the marketing gate.
//
// The point of these tests is that the gate is closed by default and that the
// UAE path refuses rather than degrades. An agent telling its human "Backters
// pays 144%" is marketing a virtual asset under VARA's Marketing Regulations
// 2024; the platform must not be able to do that accidentally.
import * as db from '../../src/services/db';
import * as marketing from '../../src/services/marketing';

jest.mock('../../src/services/db', () => ({ query: jest.fn() }));
const mockQuery = db.query as jest.Mock;

beforeEach(() => mockQuery.mockReset());

describe('marketing gate', () => {
  it('refuses UAE when nothing is cleared', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(marketing.assertCanServe('backters', 'AE'))
      .rejects.toMatchObject({ code: 'NOT_CLEARED_FOR_UAE' });
  });

  it('returns empty (not an error) for a non-UAE jurisdiction with nothing cleared', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(marketing.assertCanServe('backters', 'GB')).resolves.toEqual([]);
  });

  it('serves cleared claims', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'c1', claim_text: 'x' }] });
    const claims = await marketing.assertCanServe('backters', 'AE');
    expect(claims).toHaveLength(1);
  });

  it('the query itself excludes unlicensed UAE claims and withdrawn claims', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await marketing.clearedClaims('backters', 'AE');
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain('cleared_for_uae = true');
    expect(sql).toContain('withdrawn_at IS NULL');
    expect(sql).toContain("jurisdiction <> 'AE' OR issuer_licensed = true");
  });
});

describe('assessment validation', () => {
  it('rejects a response with no risk disclosure', () => {
    const r = marketing.validateAssessment('Backters pays 144%. I could not verify the bond backing.');
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('risk_disclosure');
  });

  it('rejects a response that claims certainty it does not have', () => {
    const r = marketing.validateAssessment(`Backters pays 144%. ${marketing.VA_RISK_DISCLOSURE}`);
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('unverified_statement');
  });

  it('accepts a response that discloses risk and names what it could not verify', () => {
    const body = `Backters advertises 144% over 3 years after a 90-day lock. ` +
      `I could not verify the bond counterparty or whether the issuer holds a VARA licence. ` +
      marketing.VA_RISK_DISCLOSURE;
    expect(marketing.validateAssessment(body)).toEqual({ ok: true, missing: [] });
  });
});

describe('clearing', () => {
  it('refuses to clear a licensed issuer without a licence reference', async () => {
    await expect(marketing.clearClaim({ id: 'c1', cleared_by: 'magnus', issuer_licensed: true }))
      .rejects.toMatchObject({ code: 'LICENCE_REF_REQUIRED' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('clears with a licence reference', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'c1', cleared_for_uae: true }] });
    const c = await marketing.clearClaim({ id: 'c1', cleared_by: 'magnus', issuer_licensed: true, licence_ref: 'VARA-XXXX' });
    expect(c.cleared_for_uae).toBe(true);
  });
});
