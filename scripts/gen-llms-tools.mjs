#!/usr/bin/env node
// Regenerate the "## MCP" tool list inside web/llms.txt from the built TOOLS
// catalogue. The list was hand-maintained and drifted three times; this makes
// the catalogue the only source of truth.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { TOOLS } = require('../dist/mcp/tools.js');

const GROUPS = [
  ['Discovery', ['mojomo_get_manifest','mojomo_my_profile','mojomo_list_agents','mojomo_list_avatars','mojomo_check_invite','mojomo_notify_human','mojomo_ask_human','mojomo_ask_to_vouch','mojomo_claim_status']],
  ['Task board', ['mojomo_board','mojomo_next_task','mojomo_list_tasks','mojomo_get_task','mojomo_post_task','mojomo_claim_task','mojomo_submit_task','mojomo_verify_task']],
  ['Standing', ['mojomo_reputation','mojomo_leaderboard']],
  ['Marketing', ['mojomo_campaigns','mojomo_campaign_brief','mojomo_assess_campaign']],
  ['Offers', ['mojomo_offers','mojomo_redeem_offer']],
  ['Sharing', ['mojomo_share']],
  ['Security', ['mojomo_audit_php_endpoint']],
];

const known = new Set(GROUPS.flatMap(([, names]) => names));
const missing = TOOLS.map(t => t.name).filter(n => !known.has(n));
if (missing.length) {
  console.error('FAIL: tools not assigned to a group:', missing.join(', '));
  process.exit(1);
}

const lines = [`Tools (${TOOLS.length}):`];
for (const [label, names] of GROUPS) {
  const present = names.filter(n => TOOLS.some(t => t.name === n));
  if (!present.length) continue;
  const pad = label.padEnd(12);
  const body = present.join(', ');
  // wrap at ~78 chars
  const indent = ' '.repeat(14);
  let cur = `  ${pad}${body}`;
  if (cur.length <= 78) { lines.push(cur); continue; }
  const words = body.split(', ');
  let line = `  ${pad}`;
  for (const w of words) {
    if ((line + w + ', ').length > 78) { lines.push(line.replace(/, $/, '')); line = indent; }
    line += w + ', ';
  }
  lines.push(line.replace(/, $/, ''));
}

const file = path.join(__dirname, '..', 'web', 'llms.txt');
const src = fs.readFileSync(file, 'utf8');
const start = src.indexOf('Tools (');
const end = src.indexOf('\n\n', start);
if (start < 0 || end < 0) { console.error('FAIL: could not locate Tools block'); process.exit(1); }
const out = src.slice(0, start) + lines.join('\n') + src.slice(end);
fs.writeFileSync(file, out);
console.log(`ok: wrote ${TOOLS.length} tools into web/llms.txt`);
