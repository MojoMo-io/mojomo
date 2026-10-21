// Sprint 6: agent intelligence.
//
// The invariant under test: we learn about AGENTS freely, and we record a human
// only when they act, with an explicit basis. Nothing scrapes or infers a human.
import * as db from '../../src/services/db';
import * as intel from '../../src/services/agentIntel';
import * as agents from '../../src/services/agents';

const uniq = () => `intel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe('fingerprint', () => {
  it('normalises common agent clients', () => {
    expect(intel.fingerprint('python-requests/2.31.0')).toBe('python-requests');
    expect(intel.fingerprint('python-httpx/0.27')).toBe('python-httpx');
    expect(intel.fingerprint('node-fetch/1.0')).toBe('node-fetch');
    expect(intel.fingerprint('Go-http-client/1.1')).toBe('go-http-client');
    expect(intel.fingerprint('curl/8.18.0')).toBe('curl');
    expect(intel.fingerprint('Mozilla/5.0 (Macintosh) Chrome/120')).toBe('browser');
    expect(intel.fingerprint('')).toBe('unknown');
  });

  it('recognises AI-specific clients', () => {
    expect(intel.fingerprint('claude-desktop/1.0')).toBe('claude');
    expect(intel.fingerprint('langchain/0.2')).toBe('langchain');
    expect(intel.fingerprint('mcp-client/1.0')).toBe('mcp-client');
  });
});

describe('inferFramework', () => {
  it('infers from sdk, endpoint or ua', () => {
    expect(intel.inferFramework({ sdk: 'langchain' })).toBe('langchain');
    expect(intel.inferFramework({ endpoint: 'https://x.fastapi.io' })).toBe('fastapi');
    expect(intel.inferFramework({ ua: 'openai-python/1.0' })).toBe('openai-sdk');
    expect(intel.inferFramework({})).toBeNull();
  });
});

describe('registration intel', () => {
  beforeAll(() => { process.env.MAIL_PROVIDER = 'console'; });

  it('records what the agent declared about itself', async () => {
    const handle = uniq();
    const out = await agents.registerAgent({
      handle,
      display_name: 'Intel Agent',
      human_email: `${handle}@example.com`,
      model_family: 'claude-sonnet-4',
      capabilities: ['code-review', 'testing'],
      endpoint_url: 'https://agent.example.com/mcp',
      operator_name: 'Acme',
      user_agent: 'python-httpx/0.27',
      ip: '203.0.113.42',
    });

    const r = await db.query(`SELECT * FROM agent.intel WHERE agent_id=$1`, [out.agent.id]);
    expect(r.rows.length).toBe(1);
    const row = r.rows[0];
    expect(row.declared_model).toBe('claude-sonnet-4');
    expect(row.declared_capabilities).toEqual(['code-review', 'testing']);
    expect(row.client_fingerprint).toBe('python-httpx');
    expect(row.registration_ip).toBe('203.0.113.42');
    expect(row.declared_framework).toBe('mcp');
  });

  it('records the human with basis invite_named, and only that', async () => {
    const handle = uniq();
    const email = `${handle}@example.com`;
    await agents.registerAgent({ handle, display_name: 'Consent', human_email: email });

    const r = await db.query(
      `SELECT basis FROM agent.human_consent WHERE email=$1 ORDER BY id`,
      [email]
    );
    expect(r.rows.map((x: any) => x.basis)).toEqual(['invite_named']);
  });

  it('records accepted and declined bases when the human acts', async () => {
    const h1 = uniq();
    const e1 = `${h1}@example.com`;
    const a = await agents.registerAgent({ handle: h1, display_name: 'A', human_email: e1 });
    const inv1 = await db.query(
      `SELECT i.id FROM agent.invitations i JOIN agent.agents ag ON ag.id=i.agent_id WHERE ag.handle=$1`, [h1]
    );
    const c1 = await agents.createClaimToken(inv1.rows[0].id);
    await agents.acceptInvitation(a.invite_token, { claim_token: c1.token });

    const h2 = uniq();
    const e2 = `${h2}@example.com`;
    const b = await agents.registerAgent({ handle: h2, display_name: 'B', human_email: e2 });
    await agents.declineInvitation(b.invite_token, { reason: 'no' });

    const r1 = await db.query(`SELECT basis FROM agent.human_consent WHERE email=$1 ORDER BY id`, [e1]);
    expect(r1.rows.map((x: any) => x.basis)).toEqual(['invite_named', 'accepted']);
    const r2 = await db.query(`SELECT basis FROM agent.human_consent WHERE email=$1 ORDER BY id`, [e2]);
    expect(r2.rows.map((x: any) => x.basis)).toEqual(['invite_named', 'declined']);
  });
});

describe('discovery reads', () => {
  it('records a read with a fingerprint', async () => {
    await intel.recordDiscoveryRead({
      surface: 'discovery', ip: '198.51.100.7', user_agent: 'python-requests/2.31',
    });
    const r = await db.query(
      `SELECT surface, client_fingerprint FROM agent.discovery_reads
        WHERE ip='198.51.100.7' ORDER BY id DESC LIMIT 1`
    );
    expect(r.rows[0].surface).toBe('discovery');
    expect(r.rows[0].client_fingerprint).toBe('python-requests');
  });

  it('increments the per-agent counter when the agent is known', async () => {
    const handle = uniq();
    const out = await agents.registerAgent({ handle, display_name: 'Counter', human_email: `${handle}@example.com` });
    await intel.recordDiscoveryRead({ surface: 'manifest', agent_id: out.agent.id });
    await intel.recordDiscoveryRead({ surface: 'manifest', agent_id: out.agent.id });
    const r = await db.query(`SELECT manifest_views FROM agent.intel WHERE agent_id=$1`, [out.agent.id]);
    expect(r.rows[0].manifest_views).toBe(2);
  });

  it('never throws when the write fails', async () => {
    const spy = jest.spyOn(db, 'query').mockRejectedValueOnce(new Error('db down'));
    await expect(intel.recordDiscoveryRead({ surface: 'llms' })).resolves.toBeUndefined();
    spy.mockRestore();
  });
});

describe('report', () => {
  it('returns the shape the CLI expects', async () => {
    const r = await intel.report(30);
    expect(r).toHaveProperty('totals');
    expect(r).toHaveProperty('by_model');
    expect(r).toHaveProperty('by_framework');
    expect(r).toHaveProperty('by_fingerprint');
    expect(r).toHaveProperty('by_surface');
    expect(r).toHaveProperty('lookers_who_never_registered');
    expect(Array.isArray(r.by_model)).toBe(true);
  });
});
