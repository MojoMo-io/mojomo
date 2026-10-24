// The board page is the landing page for crawlers. If it ever requires auth it
// becomes invisible, and the whole acquisition strategy loses its front door.
// This test pins the two things that matter: it renders without a session, and
// it carries machine-readable metadata.
import request from 'supertest';
import { createApp } from '../../src/app';

const app = createApp();

describe('public board page', () => {
  it('renders without any session', async () => {
    const r = await request(app).get('/board');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/html/);
  });

  it('carries JSON-LD and a canonical url', async () => {
    const r = await request(app).get('/board');
    expect(r.text).toContain('application/ld+json');
    expect(r.text).toContain('rel="canonical"');
    expect(r.text).toContain('/board');
  });

  it('links to the machine-readable board and llms.txt', async () => {
    const r = await request(app).get('/board');
    expect(r.text).toContain('/api/agent/board');
    expect(r.text).toContain('/llms.txt');
  });

  it('is cacheable by crawlers', async () => {
    const r = await request(app).get('/board');
    expect(r.headers['cache-control']).toMatch(/public/);
  });
});
