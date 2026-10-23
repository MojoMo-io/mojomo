// Runs once before the whole suite. Brings the dedicated test database up to
// schema so tests never depend on someone having applied migrations by hand.
//
// Two hard-won rules encoded here:
//
// 1. schema.sql wraps everything in BEGIN/COMMIT. If any statement inside it
//    fails, Postgres aborts the transaction and silently skips every remaining
//    statement — so a single "already exists" error used to wipe out the rest of
//    the schema while the run still reported success. We therefore run schema.sql
//    with ON_ERROR_STOP=1 and treat a failure as fatal, rather than swallowing it.
//
// 2. Migrations are written idempotently (IF NOT EXISTS / ADD COLUMN IF NOT
//    EXISTS), so they are safe to re-run on every test run.
//
// Finally we assert the tables the agent suites depend on actually exist. A
// green suite against a half-built database is worse than a red one.
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');

function testDbUrl(): string {
  // Mirrors src/services/db.ts: discrete DB_* vars win, DATABASE_URL is the fallback.
  const name = process.env.DB_NAME || 'mojomo_test';
  if (process.env.DATABASE_URL) {
    // Socket-shaped URLs (postgresql://postgres@/mojomo?port=5433) are not WHATWG-parseable,
    // so swap the database by string surgery rather than URL round-tripping.
    return process.env.DATABASE_URL.replace(/\/[^/?]+(\?|$)/, `/${name}$1`);
  }
  // Production uses a unix socket with peer auth (DATABASE_URL=postgresql://postgres@/mojomo?port=5433),
  // so the fallback must be socket-shaped too, not host-shaped.
  const port = process.env.DB_PORT || '5433';
  const user = encodeURIComponent(process.env.DB_USER || 'postgres');
  const pass = process.env.DB_PASSWORD ? ':' + encodeURIComponent(process.env.DB_PASSWORD) : '';
  return `postgresql://${user}${pass}@/${name}?port=${port}`;
}

function psql(url: string, args: string[]): string {
  return execFileSync('psql', [url, '-q', ...args], {
    encoding: 'utf8',
    env: { ...process.env, PGCONNECT_TIMEOUT: '10' },
  });
}

/** Tables the suite cannot run without. If these are missing, fail loudly. */
const REQUIRED_TABLES = [
  'mojomo.avatars',
  'mojomo.users',
  'agent.agents',
  'agent.invitations',
  'agent.api_keys',
  'agent.audit',
  'agent.tether_events',
  'agent.funnel_events',
  'agent.shares',
  'agent.referral_codes',
  'agent.referral_arrivals',
  'agent.offers',
  'agent.offer_impressions',
  'agent.offer_redemptions',
];

export default async function globalSetup() {
  const url = testDbUrl();
  if (!/mojomo_test/.test(url)) {
    throw new Error(`Refusing to run migrations against a non-test database: ${url.replace(/:[^:@]*@/, ':***@')}`);
  }

  // schema.sql is transactional and non-idempotent. Run it strictly: a failure
  // here means the database is in an unknown state and the suite is meaningless.
  try {
    psql(url, ['-v', 'ON_ERROR_STOP=1', '-f', path.join(ROOT, 'schema.sql')]);
  } catch (e: any) {
    const msg = String(e.stderr || e.message || '');
    // The one acceptable failure: the schema is already fully applied.
    if (!/already exists/i.test(msg)) {
      throw new Error(`[global-setup] schema.sql failed:\n${msg}`);
    }
  }

  const migrations = fs.readdirSync(path.join(ROOT, 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of migrations) {
    try {
      psql(url, ['-v', 'ON_ERROR_STOP=1', '-f', path.join(ROOT, 'migrations', file)]);
    } catch (e: any) {
      const msg = String(e.stderr || e.message || '');
      throw new Error(`[global-setup] migration ${file} failed:\n${msg}`);
    }
  }

  // Verify. A missing table must break the run, not surface later as a confusing
  // "relation does not exist" inside one test.
  const missing: string[] = [];
  for (const table of REQUIRED_TABLES) {
    const out = psql(url, ['-tAc', `SELECT to_regclass('${table}') IS NOT NULL`]).trim();
    if (out !== 't') missing.push(table);
  }
  if (missing.length > 0) {
    throw new Error(`[global-setup] test database is missing required tables: ${missing.join(', ')}`);
  }
}
