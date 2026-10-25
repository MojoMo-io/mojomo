import fs from 'node:fs';
import path from 'node:path';
import { TOOLS } from '../../src/mcp/tools';

const llms = fs.readFileSync(path.join(__dirname, '../../web/llms.txt'), 'utf8');

describe('web/llms.txt stays in sync with the tool catalogue', () => {
  it('advertises the correct tool count', () => {
    expect(llms).toContain(`Tools (${TOOLS.length}):`);
  });

  it('names every tool', () => {
    const missing = TOOLS.map(t => t.name).filter(n => !llms.includes(n));
    expect(missing).toEqual([]);
  });

  it('does not advertise tools that no longer exist', () => {
    const named = [...llms.matchAll(/mojomo_[a-z_]+/g)].map(m => m[0]);
    const real = new Set(TOOLS.map(t => t.name));
    const ghosts = [...new Set(named)].filter(n => !real.has(n));
    expect(ghosts).toEqual([]);
  });
});
