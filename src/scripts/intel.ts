#!/usr/bin/env tsx
// npm run intel [--days N] [--json]
//
// What kind of agents are finding us, and what do they want?
// Everything here is about agents, or about humans who acted deliberately.
import 'dotenv/config';
import * as intel from '../services/agentIntel';
import { closePool } from '../services/db';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function bar(n: number, max: number, width = 24): string {
  if (max <= 0) return '';
  return '█'.repeat(Math.round((n / max) * width)).padEnd(width, '·');
}

function table(title: string, rows: { key: string; n: number }[]) {
  if (!rows.length) return;
  const max = Math.max(...rows.map((r) => r.n));
  console.log(`\n  ${title}`);
  for (const r of rows) {
    console.log(`    ${String(r.key).padEnd(22)} ${String(r.n).padStart(5)}  ${bar(r.n, max)}`);
  }
}

async function main() {
  const days = Number(arg('days') || 30);
  const r = await intel.report(days);

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  console.log('');
  console.log(`MOJOMO agent intelligence — last ${r.window_days} days`);
  console.log('');
  console.log(`  Agents registered (all time)   ${r.totals.agents}`);
  console.log(`  Registered in window           ${r.totals.registered}`);
  console.log(`  Tethered (active)              ${r.totals.tethered}`);
  console.log(`  Discovery reads in window      ${r.totals.discovery_reads}`);
  console.log(`  Lookers who never registered   ${r.lookers_who_never_registered}`);

  table('By model family', r.by_model);
  table('By framework', r.by_framework);
  table('By client fingerprint (discovery reads)', r.by_fingerprint);
  table('By surface read', r.by_surface);
  table('Most declared capabilities', r.top_capabilities);

  console.log('');
}

main()
  .catch((e) => {
    console.error('intel failed:', e.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
