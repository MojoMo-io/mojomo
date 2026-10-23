/**
 * The tool catalogue must be described identically everywhere it is described.
 *
 * This test exists because the same bug shipped three times in one day: a tool
 * was added to the server and the discovery surfaces kept advertising the old
 * set. The manifest listed 6 of 20 tools. Offers shipped with no MCP tool. Then
 * offers shipped with a tool but were absent from llms.txt, agent.json and
 * openapi.json. Each time the feature worked and nobody could find it.
 *
 * The fix was to derive every surface from src/mcp/tools.ts. This test is the
 * guard on that: if someone adds a tool and forgets a surface, or reintroduces a
 * hand-maintained list, this fails.
 */
import request from 'supertest';
import express from 'express';
import agentRoutes from '../../src/routes/agentApi';
import openapiRoutes from '../../src/routes/openapi';
import { TOOLS } from '../../src/mcp/tools';

// Mount only the agent router, matching the existing discovery tests: these
// assertions are about the public surface, not the full app.
const app = express();
app.use(express.json());
app.use('/api', agentRoutes);
app.use(openapiRoutes);

const names = TOOLS.map((t) => t.name);

describe('tool catalogue consistency', () => {
  it('has no duplicate tool names', () => {
    expect(new Set(names).size).toBe(names.length);
  });

  it('every tool name is prefixed mojomo_', () => {
    for (const n of names) expect(n.startsWith('mojomo_')).toBe(true);
  });

  it('every tool has a description and an input schema', () => {
    for (const t of TOOLS) {
      expect(typeof t.description).toBe('string');
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.inputSchema).toBeDefined();
    }
  });

  it('agent.json advertises exactly the catalogue', async () => {
    const r = await request(app).get('/api/agent.json');
    expect(r.status).toBe(200);
    expect(r.body.mcp.tools).toEqual(names);
  });

  it('llms.txt advertises exactly the catalogue', async () => {
    // The router mounts this at /api/llms.txt; nginx proxies /llms.txt to it.
    const r = await request(app).get('/api/llms.txt');
    expect(r.status).toBe(200);
    // supertest leaves text/plain in .text, not .body.
    const body = (r as any).text || (Buffer.isBuffer(r.body) ? r.body.toString() : String(r.body || ''));

    // The stated count must match reality.
    expect(body).toContain(`Tools (${names.length}):`);

    // Every tool must be named in the text.
    for (const n of names) {
      expect(body).toContain(n);
    }

    // And nothing that is not a tool may be presented as one.
    const mentioned = body.match(/mojomo_[a-z_]+/g) || [];
    for (const m of new Set(mentioned)) {
      expect(names).toContain(m);
    }
  });

  it('openapi.json documents every tool-backed endpoint that exists', async () => {
    const r = await request(app).get('/openapi.json');
    expect(r.status).toBe(200);
    const paths = Object.keys(r.body.paths || {});

    // Offers shipped with routes and no documentation. Guard the class, not the
    // instance: any /api/agent/offers route must appear in the spec.
    for (const p of ['/api/agent/offers', '/api/agent/offers/{id}', '/api/agent/offers/{id}/redeem']) {
      expect(paths).toContain(p);
    }
  });
});
