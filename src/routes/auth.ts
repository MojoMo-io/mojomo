// Public authentication endpoints (mounted before requireAuth).
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import * as auth from '../services/auth';
import * as mailer from '../services/mailer';
import { sessionCookie, clearSessionCookie, parseCookies } from '../middleware/auth';
import { metrics } from '../metrics';

const router = Router();

const magicLinkLimiter = rateLimit({
  windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  limit: () => Number(process.env.AUTH_RATE_LIMIT_MAX || 5),   // read per request so tests/ops can tune without restart
  standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip || '')}|${String((req.body && req.body.email) || '').toLowerCase()}`,
  message: { error: 'Too many sign-in requests. Try again in a few minutes.' },
});

const MagicLinkSchema = z.object({ email: z.string().min(3).max(320) });

/** POST /auth/magic-link — open signup by email; always a neutral 200 afterwards (no address enumeration). */
router.post('/auth/magic-link', magicLinkLimiter, async (req: Request, res: Response) => {
  try {
    const payload = MagicLinkSchema.parse(req.body);
    if (!auth.isValidEmail(auth.normalizeEmail(payload.email))) {
      return res.status(400).json({ error: 'Enter a valid email address' });
    }
    const link = await auth.createMagicLink(payload.email);
    const sent = await mailer.sendMagicLinkEmail(link.email, link.url, auth.MAGIC_LINK_TTL_MIN);
    metrics.magicLinks.inc({ provider: sent.provider, accepted: String(sent.accepted) });
    if (sent.provider === 'smtp' && !sent.accepted) {
      // Provider-side failure is not address-specific, so reporting it does not enable enumeration.
      return res.status(503).json({ error: 'The sign-in email could not be sent right now. Please try again in a few minutes.' });
    }
    const body: any = { ok: true, message: 'If that address is yours, a sign-in link is on its way. It works once and expires in 20 minutes.' };
    if (sent.provider === 'console' && process.env.NODE_ENV !== 'production') body.debug_link = link.url;
    if (sent.provider === 'console' && process.env.NODE_ENV === 'production') body.message = 'Email delivery is not configured yet. Ask the administrator for your sign-in link.';
    res.json(body);
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Validation failed', details: error.errors });
    console.error('Error issuing magic link:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** GET /auth/verify?token= — consume the link, set the session cookie, go home. */
router.get('/auth/verify', async (req: Request, res: Response) => {
  const token = String(req.query.token || '');
  try {
    const s = await auth.consumeMagicLink(token, { user_agent: req.headers['user-agent'], ip: req.ip });
    res.setHeader('Set-Cookie', sessionCookie(s.sessionToken, auth.SESSION_TTL_DAYS * 24 * 60 * 60));
    metrics.loginAttempts.inc({ result: 'success' });
    if (req.accepts(['html', 'json']) === 'json' && !req.headers.accept?.includes('text/html')) {
      return res.json({ ok: true, user_id: s.userId, email: s.email, expires_at: s.expires_at });
    }
    // Honour a same-site destination so a link from Telegram lands where it meant to.
    const next = String(req.query.next || '');
    const safeNext = /^\/[^\/\\]/.test(next) ? next : '/';
    res.redirect(302, safeNext);
  } catch (error: any) {
    metrics.loginAttempts.inc({ result: 'bad_link' });
    if (req.headers.accept?.includes('application/json')) return res.status(400).json({ error: 'Invalid or expired link' });
    res.redirect(302, '/login?error=expired');
  }
});

/** GET /auth/check — for nginx auth_request: 200 when a valid session cookie is present, else 401. */
router.get('/auth/check', async (req: Request, res: Response) => {
  const s = await auth.getSession(parseCookies(req.headers.cookie)[auth.SESSION_COOKIE]).catch(() => null);
  res.status(s ? 200 : 401).end();
});

/** GET /auth/check-admin — for nginx auth_request on support.mojomo.io: 200 only for an admin session. */
router.get('/auth/check-admin', async (req: Request, res: Response) => {
  const s = await auth.getSession(parseCookies(req.headers.cookie)[auth.SESSION_COOKIE]).catch(() => null);
  if (!s) return res.status(401).end();
  const admin = await auth.isAdmin(s.userId).catch(() => false);
  res.status(admin ? 200 : 403).end();
});

/** GET /auth/me */
router.get('/auth/me', async (req: Request, res: Response) => {
  const s = await auth.getSession(parseCookies(req.headers.cookie)[auth.SESSION_COOKIE]).catch(() => null);
  if (!s) return res.status(401).json({ error: 'Authentication required', login: '/login' });
  res.json({ user_id: s.userId, email: s.email, session_expires_at: s.expires_at });
});

/** POST /auth/logout */
router.post('/auth/logout', async (req: Request, res: Response) => {
  await auth.destroySession(parseCookies(req.headers.cookie)[auth.SESSION_COOKIE]).catch(() => undefined);
  res.setHeader('Set-Cookie', clearSessionCookie());
  res.json({ ok: true });
});

export default router;
