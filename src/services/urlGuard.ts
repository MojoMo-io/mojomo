/**
 * SSRF guard for agent-supplied URLs.
 *
 * Agents register with an endpoint URL they control. Before we ever fetch it we
 * must refuse anything that could reach our own network, cloud metadata, or
 * loopback. Redirects are followed manually so each hop is re-checked — a
 * public URL that 302s to 169.254.169.254 is the classic bypass.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const BLOCKED_V4 = [
  ['0.0.0.0', 8],        // "this" network
  ['10.0.0.0', 8],       // private
  ['100.64.0.0', 10],    // CGNAT
  ['127.0.0.0', 8],      // loopback
  ['169.254.0.0', 16],   // link-local + cloud metadata
  ['172.16.0.0', 12],    // private
  ['192.0.0.0', 24],     // IETF protocol assignments
  ['192.168.0.0', 16],   // private
  ['198.18.0.0', 15],    // benchmarking
  ['224.0.0.0', 4],      // multicast
  ['240.0.0.0', 4],      // reserved
] as const;

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

function isBlockedV4(ip: string): boolean {
  const n = v4ToInt(ip);
  return BLOCKED_V4.some(([base, bits]) => {
    const mask = (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (v4ToInt(base) & mask);
  });
}

function isBlockedV6(ip: string): boolean {
  const s = ip.toLowerCase();
  if (s === '::' || s === '::1') return true;
  if (s.startsWith('fe80')) return true;            // link-local
  if (/^f[cd]/.test(s)) return true;                // unique local
  if (s.startsWith('ff')) return true;              // multicast
  // IPv4-mapped (::ffff:127.0.0.1) — unwrap and re-check
  const m = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (m) return isBlockedV4(m[1]);
  return false;
}

export function isBlockedAddress(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) return isBlockedV4(ip);
  if (fam === 6) return isBlockedV6(ip);
  return true; // unparseable — refuse
}

export interface GuardResult {
  ok: boolean;
  reason?: string;
  url?: URL;
}

/** Validate a URL is safe to fetch. Resolves DNS and checks every address. */
export async function guardUrl(raw: string): Promise<GuardResult> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: 'not a valid URL' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { ok: false, reason: `scheme ${u.protocol} not allowed` };
  }
  if (u.username || u.password) {
    return { ok: false, reason: 'credentials in URL not allowed' };
  }
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    return isBlockedAddress(host)
      ? { ok: false, reason: 'address is in a blocked range' }
      : { ok: true, url: u };
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    return { ok: false, reason: 'hostname did not resolve' };
  }
  if (!addrs.length) return { ok: false, reason: 'hostname did not resolve' };
  for (const a of addrs) {
    if (isBlockedAddress(a.address)) {
      return { ok: false, reason: 'hostname resolves to a blocked range' };
    }
  }
  return { ok: true, url: u };
}

/**
 * Fetch with SSRF protection. Follows redirects manually, re-guarding each hop.
 */
export async function safeFetch(
  raw: string,
  init: RequestInit = {},
  maxHops = 3
): Promise<Response> {
  let current = raw;
  for (let hop = 0; hop <= maxHops; hop++) {
    const g = await guardUrl(current);
    if (!g.ok) throw new Error(`blocked: ${g.reason}`);
    const res = await fetch(current, { ...init, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return res;
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
  throw new Error('blocked: too many redirects');
}

export default { guardUrl, safeFetch, isBlockedAddress };
