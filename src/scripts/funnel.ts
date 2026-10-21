#!/usr/bin/env tsx
// npm run funnel [--days N] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--json]
//
// Prints the human-request funnel: how many agents registered, how many of their
// humans got the email, opened it, and accepted. One command answers
// "where are we losing people?".
import 'dotenv/config';
import * as funnel from '../services/funnel';
import { closePool } from '../services/db';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function pct(n: number | null): string {
  return n === null ? '  —  ' : `${(n * 100).toFixed(1)}%`.padStart(6);
}

function bar(n: number, max: number, width = 28): string {
  if (max <= 0) return '';
  const filled = Math.round((n / max) * width);
  return '█'.repeat(filled) + '·'.repeat(width - filled);
}

async function main() {
  const days = Number(arg('days') || 7);
  const to = arg('to') ? new Date(`${arg('to')}T00:00:00Z`) : new Date();
  const from = arg('from')
    ? new Date(`${arg('from')}T00:00:00Z`)
    : new Date(to.getTime() - days * 86400_000);

  const r = await funnel.report(from, to);

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  console.log('');
  console.log(`MOJOMO funnel  ${r.from.slice(0, 10)} → ${r.to.slice(0, 10)}`);
  console.log('');

  const max = Math.max(...funnel.FUNNEL_ORDER.map((s) => r.unique[s]), 1);
  const labels: Record<string, string> = {
    registered: 'Agents registered',
    email_sent: 'Invite email sent',
    invite_opened: 'Human opened link',
    accepted: 'Human accepted',
  };

  for (const stage of funnel.FUNNEL_ORDER) {
    const n = r.unique[stage];
    const conv = r.conversion.find((c) => c.to === stage);
    console.log(
      `  ${labels[stage].padEnd(20)} ${String(n).padStart(6)}  ${bar(n, max)}  ${conv ? pct(conv.rate) : '     '}`
    );
  }

  console.log('');
  console.log('  Failure branches');
  console.log(`  ${'Email failed'.padEnd(20)} ${String(r.counts.email_failed).padStart(6)}`);
  console.log(`  ${'Declined'.padEnd(20)} ${String(r.unique.declined).padStart(6)}`);
  console.log(`  ${'Expired'.padEnd(20)} ${String(r.unique.expired).padStart(6)}`);

  if (r.biggest_drop) {
    const d = r.biggest_drop;
    console.log('');
    console.log(
      `  Biggest drop: ${labels[d.from]} → ${labels[d.to]} — ${d.lost} lost (${pct(d.rate)} convert)`
    );
  }

  const total = r.unique.registered;
  if (total > 0) {
    console.log('');
    console.log(`  End-to-end: ${r.unique.accepted}/${total} registrations became tethered agents (${pct(r.unique.accepted / total)})`);
  } else {
    console.log('');
    console.log('  No registrations in this window.');
  }
  console.log('');
}

main()
  .catch((e) => {
    console.error('funnel failed:', e.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
