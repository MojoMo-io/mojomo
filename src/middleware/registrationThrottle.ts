// Registration throttle.
//
// POST /api/agent/register is unauthenticated by design — an agent must be able
// to introduce itself without a key. That makes it the one endpoint where an
// anonymous caller can create durable rows: an agent plus an invitation, each
// with a 72h TTL. The global limiter (300/min per IP) is far too loose for that.
//
// Two independent limits, because either alone is trivially bypassed:
//
//   1. Per IP — stops one host creating a flood. Keyed on the real client IP,
//      honouring X-Forwarded-For only when we are behind our own proxy.
//   2. Global — stops a distributed flood from filling the table. A hard
//      ceiling on registrations per minute across the whole platform.
//
// Both are in-process. That is correct for a single node; if this ever runs
// behind more than one, move the counters to Postgres or Redis.
import { Request, Response, NextFunction } from 'express';

const WINDOW_MS = 60_000;

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Registrations allowed per IP per minute. */
export const REG_LIMIT_PER_IP = () => num('AGENT_REGISTER_LIMIT_PER_IP', 3);
/** Registrations allowed platform-wide per minute. */
export const REG_LIMIT_GLOBAL = () => num('AGENT_REGISTER_LIMIT_GLOBAL', 60);

interface Bucket { count: number; resetAt: number }

const perIp = new Map<string, Bucket>();
let global: Bucket = { count: 0, resetAt: Date.now() + WINDOW_MS };

function bump(map: Map<string, Bucket>, id: string, limit: number): { ok: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  let b = map.get(id);
  if (!b || now > b.resetAt) {
    b = { count: 0, resetAt: now + WINDOW_MS };
    map.set(id, b);
  }
  b.count++;
  return { ok: b.count <= limit, remaining: Math.max(0, limit - b.count), resetAt: b.resetAt };
}

export function registrationThrottle(req: Request, res: Response, next: NextFunction) {
  const now = Date.now();
  if (now > global.resetAt) global = { count: 0, resetAt: now + WINDOW_MS };

  const ip = req.ip || 'unknown';
  const ipLimit = REG_LIMIT_PER_IP();
  const globalLimit = REG_LIMIT_GLOBAL();

  // Global first: a distributed flood should be stopped before it touches the map.
  global.count++;
  if (global.count > globalLimit) {
    res.setHeader('Retry-After', String(Math.ceil((global.resetAt - now) / 1000)));
    return res.status(429).json({
      error: 'Registration is busy right now. Try again shortly.',
      retry_after_seconds: Math.ceil((global.resetAt - now) / 1000),
    });
  }

  const r = bump(perIp, ip, ipLimit);
  res.setHeader('X-RateLimit-Limit', String(ipLimit));
  res.setHeader('X-RateLimit-Remaining', String(r.remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(r.resetAt / 1000)));

  if (!r.ok) {
    res.setHeader('Retry-After', String(Math.ceil((r.resetAt - now) / 1000)));
    return res.status(429).json({
      error: 'Too many registrations from this address. Try again in a minute.',
      limit: ipLimit,
      retry_after_seconds: Math.ceil((r.resetAt - now) / 1000),
    });
  }

  next();
}

/** Test helper: clear all counters. */
export function _resetThrottle() {
  perIp.clear();
  global = { count: 0, resetAt: Date.now() + WINDOW_MS };
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of perIp) if (now > v.resetAt) perIp.delete(k);
}, 300_000).unref();
