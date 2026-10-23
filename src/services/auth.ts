// Magic-link authentication + sessions (Phase 5, first build).
// Open signup by email; identity comes from a single-use emailed link.
import { createHash, randomBytes } from 'crypto';
import * as db from './db';

export const MAGIC_LINK_TTL_MIN = Number(process.env.MAGIC_LINK_TTL_MIN || 20);
export const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS || 30);
export const SESSION_COOKIE = 'mojomo_session';

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');
export const normalizeEmail = (e: string) => e.trim().toLowerCase();
export const isValidEmail = (e: string) => /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(e);

export function publicUrl(): string {
  return (process.env.PUBLIC_URL || 'https://mojomo.io').replace(/\/$/, '');
}

export async function createMagicLink(rawEmail: string, next?: string): Promise<{ email: string; token: string; url: string; expires_at: Date }> {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) throw new Error('Invalid email address');
  const token = randomToken();
  const expires_at = new Date(Date.now() + MAGIC_LINK_TTL_MIN * 60 * 1000);
  await db.query(
    `INSERT INTO mojomo.auth_tokens (email, token_hash, purpose, expires_at) VALUES ($1, $2, 'magic_link', $3)`,
    [email, hashToken(token), expires_at]
  );
  // Only allow same-site relative paths as a post-login destination.
  const safeNext = next && /^\/[^\/\\]/.test(next) ? next : '';
  const q = `token=${encodeURIComponent(token)}` + (safeNext ? `&next=${encodeURIComponent(safeNext)}` : '');
  return { email, token, url: `${publicUrl()}/api/auth/verify?${q}`, expires_at };
}

/**
 * Exchange a magic-link token for a session.
 *
 * Reusable for a short grace window after first use. Telegram and other chat
 * clients prefetch links to build a preview, which would otherwise burn a
 * single-use token before the human ever taps it. Outside the window, used
 * tokens fail exactly like expired ones.
 */
const MAGIC_LINK_REUSE_GRACE_SEC = 120;
export async function consumeMagicLink(
  token: string,
  meta: { user_agent?: string; ip?: string } = {}
): Promise<{ sessionToken: string; userId: string; email: string; expires_at: Date }> {
  if (!token || token.length < 20) throw new Error('Invalid or expired link');
  return db.withTransaction(async (client) => {
    const t = await client.query(
      `UPDATE mojomo.auth_tokens SET used_at = COALESCE(used_at, NOW())
       WHERE token_hash = $1 AND purpose = 'magic_link' AND expires_at > NOW()
         AND (used_at IS NULL OR used_at > NOW() - ($2 || ' seconds')::interval)
       RETURNING email`,
      [hashToken(token), String(MAGIC_LINK_REUSE_GRACE_SEC)]
    );
    if (t.rows.length === 0) throw new Error('Invalid or expired link');
    const email: string = t.rows[0].email;
    const u = await client.query(
      `INSERT INTO mojomo.users (id, email) VALUES (gen_random_uuid(), $1)
       ON CONFLICT (email) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [email]
    );
    const userId: string = u.rows[0].id;
    const sessionToken = randomToken();
    const expires_at = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    await client.query(
      `INSERT INTO mojomo.sessions (user_id, token_hash, expires_at, user_agent, ip) VALUES ($1, $2, $3, $4, $5)`,
      [userId, hashToken(sessionToken), expires_at, (meta.user_agent || '').slice(0, 512) || null, (meta.ip || '').slice(0, 64) || null]
    );
    return { sessionToken, userId, email, expires_at };
  });
}

export interface SessionInfo { userId: string; email: string; sessionId: string; expires_at: Date }

export async function getSession(token: string | undefined): Promise<SessionInfo | null> {
  if (!token || token.length < 20) return null;
  const r = await db.query(
    `SELECT s.id, s.user_id, s.expires_at, s.last_seen_at, u.email
     FROM mojomo.sessions s JOIN mojomo.users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
    [hashToken(token)]
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  // touch at most once a minute to keep writes low
  if (Date.now() - new Date(row.last_seen_at).getTime() > 60_000) {
    db.query('UPDATE mojomo.sessions SET last_seen_at = NOW() WHERE id = $1', [row.id]).catch(() => undefined);
  }
  return { userId: row.user_id, email: row.email, sessionId: row.id, expires_at: new Date(row.expires_at) };
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  await db.query('DELETE FROM mojomo.sessions WHERE token_hash = $1', [hashToken(token)]);
}

export async function ownsAvatar(userId: string, avatarId: string): Promise<boolean> {
  const r = await db.query('SELECT 1 FROM mojomo.avatars WHERE id = $1 AND user_id = $2', [avatarId, userId]);
  return r.rows.length > 0;
}

/** True when any of the user's avatars is the creator, co-creator, or a participant of the conversation. */
export async function isParticipant(userId: string, conversationId: string): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM mojomo.conversations c
     WHERE c.id = $1 AND EXISTS (
       SELECT 1 FROM mojomo.avatars a WHERE a.user_id = $2
         AND (a.id = c.initiator_avatar_id OR a.id = c.target_avatar_id OR a.id = ANY(c.participant_avatar_ids)))`,
    [conversationId, userId]
  );
  return r.rows.length > 0;
}

export async function isAdmin(userId: string): Promise<boolean> {
  const r = await db.query('SELECT is_admin FROM mojomo.users WHERE id = $1', [userId]);
  return r.rows.length > 0 && r.rows[0].is_admin === true;
}

export async function purgeExpiredAuth(): Promise<{ tokens: number; sessions: number }> {
  const t = await db.query(`DELETE FROM mojomo.auth_tokens WHERE expires_at < NOW() - interval '1 day' OR used_at < NOW() - interval '1 day'`);
  const s = await db.query(`DELETE FROM mojomo.sessions WHERE expires_at < NOW()`);
  return { tokens: t.rowCount || 0, sessions: s.rowCount || 0 };
}

export default { createMagicLink, consumeMagicLink, getSession, destroySession, ownsAvatar, isParticipant, isAdmin, purgeExpiredAuth };
