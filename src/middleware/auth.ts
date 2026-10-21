// Session resolution, page/API gating, and ownership enforcement.
import { Request, Response, NextFunction } from 'express';
import * as auth from '../services/auth';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { auth?: { userId: string; email: string; sessionId: string } }
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Shared across mojomo.io and support.mojomo.io so one magic-link login covers both. Set
// COOKIE_DOMAIN='' to disable if this ever needs to be host-only again.
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN ?? '.mojomo.io';

export function sessionCookie(value: string, maxAgeSeconds: number): string {
  const secure = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true';
  const domain = COOKIE_DOMAIN ? `; Domain=${COOKIE_DOMAIN}` : '';
  return `${auth.SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${domain}${secure ? '; Secure' : ''}`;
}
export const clearSessionCookie = () => {
  const domain = COOKIE_DOMAIN ? `; Domain=${COOKIE_DOMAIN}` : '';
  return `${auth.SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${domain}`;
};

/** Resolve the session cookie. Client-supplied x-user-id is never trusted: it is replaced by the session's user. */
export async function attachSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  delete req.headers['x-user-id'];
  try {
    const token = parseCookies(req.headers.cookie)[auth.SESSION_COOKIE];
    const s = await auth.getSession(token);
    if (s) {
      req.auth = { userId: s.userId, email: s.email, sessionId: s.sessionId };
      req.headers['x-user-id'] = s.userId; // legacy routes read this header
    }
  } catch (e) {
    console.error('Session lookup failed:', e);
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) { res.status(401).json({ error: 'Authentication required', login: '/login' }); return; }
  next();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESOURCE = new Set(['conversations', 'avatars', 'ideas', 'messages', 'payouts', 'reasoning-logs', 'refinements', 'specialists']);
const LITERALS = new Set(['initiate', 'ownership', 'vesting', 'end', 'forfeiture-status', 'participants', 'messages', 'ideas',
  'ideas-messages', 'ideas-by-maturity', 'reasoning', 'refinements', 'specialists', 'payouts', 'avatars', 'telegram']);

/** Any path segment that follows a resource name must be a UUID (or a known literal) -> otherwise 404, never a DB error. */
export function validateIdParams(req: Request, res: Response, next: NextFunction): void {
  const segs = req.path.split('/').filter(Boolean);
  for (let i = 1; i < segs.length; i++) {
    if (RESOURCE.has(segs[i - 1]) && !LITERALS.has(segs[i]) && !UUID.test(segs[i])) {
      res.status(404).json({ error: 'Not found' }); return;
    }
  }
  next();
}

/** Admin-only routes (support dashboard). Applied after requireAuth. */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const r = await auth.isAdmin(req.auth!.userId);
    if (!r) { res.status(403).json({ error: 'Admin access required' }); return; }
    next();
  } catch (e) {
    console.error('Admin check failed:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * You may only act as your own avatars, and only inside conversations you take part in.
 * Applied after requireAuth to every /api route.
 */
export async function enforceOwnership(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = req.auth!.userId;
  try {
    const body = req.body || {};
    for (const key of ['avatar_id', 'initiator_avatar_id', 'specialist_avatar_id'] as const) {
      if (typeof body[key] === 'string' && UUID.test(body[key]) && !(await auth.ownsAvatar(userId, body[key]))) {
        res.status(403).json({ error: `${key} does not belong to you` }); return;
      }
    }
    const m = req.path.match(/^\/conversations\/([0-9a-f-]{36})(\/|$)/i);
    if (m && !(await auth.isParticipant(userId, m[1]))) {
      // hide existence from non-participants
      res.status(404).json({ error: 'Conversation not found' }); return;
    }
    next();
  } catch (e) {
    console.error('Ownership check failed:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}
