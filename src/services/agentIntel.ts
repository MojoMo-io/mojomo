// Agent intelligence: what kind of agents find us, and what do they want?
//
// The rule this file exists to enforce: we learn about AGENTS, and we record
// humans only when they act. Nothing here scrapes, enriches, or infers a human.
import * as db from './db';

/** Normalise a User-Agent into a stable client family. */
export function fingerprint(ua: string | undefined): string {
  const s = (ua || '').toLowerCase();
  if (!s) return 'unknown';
  if (s.includes('python-requests')) return 'python-requests';
  if (s.includes('python-httpx') || s.includes('httpx')) return 'python-httpx';
  if (s.includes('aiohttp')) return 'aiohttp';
  if (s.includes('node-fetch') || s.includes('undici')) return 'node-fetch';
  if (s.includes('axios')) return 'axios';
  if (s.includes('go-http-client')) return 'go-http-client';
  if (s.includes('okhttp')) return 'okhttp';
  if (s.includes('curl')) return 'curl';
  if (s.includes('wget')) return 'wget';
  if (s.includes('postman')) return 'postman';
  if (s.includes('claude')) return 'claude';
  if (s.includes('openai') || s.includes('gpt')) return 'openai';
  if (s.includes('anthropic')) return 'anthropic';
  if (s.includes('langchain')) return 'langchain';
  if (s.includes('mcp')) return 'mcp-client';
  if (s.includes('headlesschrome') || s.includes('playwright') || s.includes('puppeteer')) return 'browser-automation';
  if (s.includes('mozilla') || s.includes('chrome') || s.includes('safari')) return 'browser';
  return 'other';
}

/** Infer a framework from a declared endpoint or SDK string. Public data only. */
export function inferFramework(hints: { sdk?: string; endpoint?: string; ua?: string }): string | null {
  const hay = `${hints.sdk || ''} ${hints.endpoint || ''} ${hints.ua || ''}`.toLowerCase();
  const map: [string, string][] = [
    ['langchain', 'langchain'],
    ['llamaindex', 'llamaindex'],
    ['autogen', 'autogen'],
    ['crewai', 'crewai'],
    ['semantic-kernel', 'semantic-kernel'],
    ['vercel/ai', 'vercel-ai'],
    ['openai', 'openai-sdk'],
    ['anthropic', 'anthropic-sdk'],
    ['mcp', 'mcp'],
    ['fastapi', 'fastapi'],
    ['flask', 'flask'],
    ['express', 'express'],
    ['next', 'nextjs'],
    ['cloudflare', 'cloudflare-workers'],
    ['aws', 'aws-lambda'],
    ['vercel', 'vercel'],
  ];
  for (const [needle, name] of map) if (hay.includes(needle)) return name;
  return null;
}

export interface RegisterIntel {
  agent_id: string;
  declared_model?: string | null;
  declared_framework?: string | null;
  declared_sdk?: string | null;
  declared_capabilities?: string[];
  declared_endpoint?: string | null;
  declared_operator?: string | null;
  declared_operator_url?: string | null;
  user_agent?: string;
  ip?: string;
  country?: string | null;
  extra?: Record<string, unknown>;
}

/** Record what an agent told us about itself at registration. Best-effort. */
export async function recordRegistration(i: RegisterIntel): Promise<void> {
  try {
    const fp = fingerprint(i.user_agent);
    const framework = i.declared_framework || inferFramework({
      sdk: i.declared_sdk || undefined,
      endpoint: i.declared_endpoint || undefined,
      ua: i.user_agent,
    });
    await db.query(
      `INSERT INTO agent.intel
         (agent_id, declared_model, declared_framework, declared_sdk, declared_capabilities,
          declared_endpoint, declared_operator, declared_operator_url,
          user_agent, client_fingerprint, registration_ip, registration_country, extra)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (agent_id) DO UPDATE SET
         declared_model = COALESCE(EXCLUDED.declared_model, agent.intel.declared_model),
         declared_framework = COALESCE(EXCLUDED.declared_framework, agent.intel.declared_framework),
         declared_sdk = COALESCE(EXCLUDED.declared_sdk, agent.intel.declared_sdk),
         declared_capabilities = EXCLUDED.declared_capabilities,
         declared_endpoint = COALESCE(EXCLUDED.declared_endpoint, agent.intel.declared_endpoint),
         declared_operator = COALESCE(EXCLUDED.declared_operator, agent.intel.declared_operator),
         declared_operator_url = COALESCE(EXCLUDED.declared_operator_url, agent.intel.declared_operator_url),
         user_agent = EXCLUDED.user_agent,
         client_fingerprint = EXCLUDED.client_fingerprint,
         registration_ip = EXCLUDED.registration_ip,
         registration_country = COALESCE(EXCLUDED.registration_country, agent.intel.registration_country),
         extra = agent.intel.extra || EXCLUDED.extra,
         updated_at = now()`,
      [
        i.agent_id,
        i.declared_model || null,
        framework,
        i.declared_sdk || null,
        i.declared_capabilities || [],
        i.declared_endpoint || null,
        i.declared_operator || null,
        i.declared_operator_url || null,
        (i.user_agent || '').slice(0, 500) || null,
        fp,
        i.ip || null,
        i.country || null,
        JSON.stringify(i.extra || {}),
      ]
    );
  } catch (e: any) {
    console.error('intel recordRegistration failed:', e.message);
  }
}

/** Record a read of a public discovery surface. Best-effort, never blocks. */
export async function recordDiscoveryRead(r: {
  surface: 'discovery' | 'manifest' | 'llms' | 'openapi' | 'agent_json';
  ip?: string;
  user_agent?: string;
  referer?: string;
  agent_id?: string | null;
}): Promise<void> {
  try {
    await db.query(
      `INSERT INTO agent.discovery_reads (surface, ip, user_agent, client_fingerprint, referer, agent_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [r.surface, r.ip || null, (r.user_agent || '').slice(0, 500) || null,
       fingerprint(r.user_agent), (r.referer || '').slice(0, 500) || null, r.agent_id || null]
    );
    if (r.agent_id) {
      const col = r.surface === 'discovery' ? 'discovery_views'
        : r.surface === 'manifest' ? 'manifest_views'
        : r.surface === 'llms' ? 'llms_views'
        : r.surface === 'openapi' ? 'openapi_views' : null;
      if (col) {
        await db.query(
          `UPDATE agent.intel SET ${col} = ${col} + 1, last_seen_at = now() WHERE agent_id = $1`,
          [r.agent_id]
        );
      }
    }
  } catch (e: any) {
    console.error('intel recordDiscoveryRead failed:', e.message);
  }
}

/**
 * Record that a human acted. This is the ONLY place a human's email is written
 * outside the invitation itself, and it requires an explicit basis.
 */
export async function recordHumanConsent(c: {
  email: string;
  basis: 'invite_named' | 'claim_opened' | 'accepted' | 'declined';
  agent_id?: string | null;
  invitation_id?: string | null;
  ip?: string;
  user_agent?: string;
}): Promise<void> {
  try {
    await db.query(
      `INSERT INTO agent.human_consent (email, basis, agent_id, invitation_id, ip, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [c.email.toLowerCase(), c.basis, c.agent_id || null, c.invitation_id || null,
       c.ip || null, (c.user_agent || '').slice(0, 500) || null]
    );
  } catch (e: any) {
    console.error('intel recordHumanConsent failed:', e.message);
  }
}

/** Check a declared endpoint. Public data only — a HEAD request, no auth, no body. */
export async function probeEndpoint(agentId: string, url: string): Promise<void> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, { method: 'HEAD', signal: ctrl.signal, redirect: 'follow' });
    clearTimeout(t);
    await db.query(
      `UPDATE agent.intel SET endpoint_reachable=$1, endpoint_status=$2, endpoint_server=$3,
              endpoint_checked_at=now(), updated_at=now()
        WHERE agent_id=$4`,
      [res.ok, res.status, res.headers.get('server'), agentId]
    );
  } catch {
    await db.query(
      `UPDATE agent.intel SET endpoint_reachable=false, endpoint_checked_at=now(), updated_at=now()
        WHERE agent_id=$1`,
      [agentId]
    ).catch(() => undefined);
  }
}

export interface IntelReport {
  window_days: number;
  totals: { agents: number; registered: number; tethered: number; discovery_reads: number };
  by_model: { key: string; n: number }[];
  by_framework: { key: string; n: number }[];
  by_fingerprint: { key: string; n: number }[];
  by_surface: { key: string; n: number }[];
  lookers_who_never_registered: number;
  top_capabilities: { key: string; n: number }[];
}

export async function report(days = 30): Promise<IntelReport> {
  const since = new Date(Date.now() - days * 86400_000);
  const q = async (sql: string, params: any[] = []) => (await db.query(sql, params)).rows;

  const [totals] = await q(
    `SELECT
       (SELECT count(*)::int FROM agent.agents) AS agents,
       (SELECT count(*)::int FROM agent.agents WHERE created_at >= $1) AS registered,
       (SELECT count(*)::int FROM agent.agents WHERE status='active') AS tethered,
       (SELECT count(*)::int FROM agent.discovery_reads WHERE created_at >= $1) AS discovery_reads`,
    [since]
  );

  const by_model = await q(
    `SELECT COALESCE(declared_model,'(not stated)') AS key, count(*)::int AS n
       FROM agent.intel GROUP BY 1 ORDER BY n DESC LIMIT 12`
  );
  const by_framework = await q(
    `SELECT COALESCE(declared_framework,'(unknown)') AS key, count(*)::int AS n
       FROM agent.intel GROUP BY 1 ORDER BY n DESC LIMIT 12`
  );
  const by_fingerprint = await q(
    `SELECT COALESCE(client_fingerprint,'unknown') AS key, count(*)::int AS n
       FROM agent.discovery_reads WHERE created_at >= $1 GROUP BY 1 ORDER BY n DESC LIMIT 12`,
    [since]
  );
  const by_surface = await q(
    `SELECT surface AS key, count(*)::int AS n
       FROM agent.discovery_reads WHERE created_at >= $1 GROUP BY 1 ORDER BY n DESC`,
    [since]
  );
  const [lookers] = await q(
    `SELECT count(DISTINCT ip)::int AS n FROM agent.discovery_reads
      WHERE created_at >= $1 AND ip IS NOT NULL
        AND ip NOT IN (SELECT registration_ip FROM agent.intel WHERE registration_ip IS NOT NULL)`,
    [since]
  );
  const top_capabilities = await q(
    `SELECT unnest(declared_capabilities) AS key, count(*)::int AS n
       FROM agent.intel GROUP BY 1 ORDER BY n DESC LIMIT 12`
  );

  return {
    window_days: days,
    totals,
    by_model,
    by_framework,
    by_fingerprint,
    by_surface,
    lookers_who_never_registered: lookers?.n || 0,
    top_capabilities,
  };
}

export default { fingerprint, inferFramework, recordRegistration, recordDiscoveryRead, recordHumanConsent, probeEndpoint, report };
