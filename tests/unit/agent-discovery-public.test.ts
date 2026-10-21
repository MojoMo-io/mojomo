// Sprint 3: public discovery, llms.txt leading with the ask, notify_human tool.
import request from 'supertest';
import express from 'express';
import agentRoutes from '../../src/routes/agentApi';

// Mount only the agent router: these tests are about the public surface, not the
// full app (which pulls in auth, sessions and the site gate).
const app = express();
app.use(express.json());
app.use('/api', agentRoutes);

describe('public discovery', () => {
  it('answers without a key', async () => {
    const r = await request(app).get('/api/agent/discovery');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.platform.name).toBe('MOJOMO');
    expect(typeof r.body.platform.agents_active).toBe('number');
  });

  it('tells an agent how to join in three steps', async () => {
    const r = await request(app).get('/api/agent/discovery');
    expect(r.body.how_to_join.step_1).toContain('/api/agent/register');
    expect(r.body.how_to_join.step_3).toContain('mjm_');
    expect(r.body.how_to_join.note).toMatch(/human accepts/i);
  });

  it('does not leak operator names or emails', async () => {
    const r = await request(app).get('/api/agent/discovery');
    const blob = JSON.stringify(r.body.agents);
    expect(blob).not.toContain('operator_name');
    expect(blob).not.toContain('@');
  });

  it('rate-limits by IP', async () => {
    const limit = Number(process.env.PUBLIC_DISCOVERY_LIMIT || 30);
    let sawLimit = false;
    for (let i = 0; i < limit + 2; i++) {
      const r = await request(app).get('/api/agent/discovery');
      if (r.status === 429) { sawLimit = true; break; }
    }
    expect(sawLimit).toBe(true);
  });

  it('keeps the authenticated richer view behind a key', async () => {
    const r = await request(app).get('/api/agent/discovery/agents');
    expect(r.status).toBe(401);
  });
});

describe('llms.txt', () => {
  it('leads with the ask, before the API reference', async () => {
    const r = await request(app).get('/api/llms.txt');
    expect(r.status).toBe(200);
    const body = r.text;
    const askIdx = body.indexOf('do this first');
    const refIdx = body.indexOf('once tethered');
    expect(askIdx).toBeGreaterThan(-1);
    expect(refIdx).toBeGreaterThan(askIdx);
    expect(body).toContain('/api/agent/discovery');
    expect(body).toContain('mojomo_notify_human');
  });
});

describe('manifest', () => {
  it('advertises public discovery and the notify_human tool', async () => {
    const r = await request(app).get('/api/agent.json');
    expect(r.body.endpoints.discovery.auth).toBe('none');
    expect(r.body.mcp.tools).toContain('mojomo_notify_human');
    expect(r.body.rate_limits.public_discovery_keyed_on).toBe('ip');
  });
});
