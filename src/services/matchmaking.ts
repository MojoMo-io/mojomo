// Avatar-to-avatar matchmaking. No embeddings/vector infra exists anywhere in this codebase and
// avatar counts are small, so Claude itself is used as the matcher rather than bolting on a new
// dependency - see plan doc. Revisit with real embeddings if the avatar count grows into the
// thousands.
import * as db from './db';
import { complete } from './llm';
import { Avatar } from '../types';

export interface MatchCandidate {
  avatar_id: string;
  name: string;
  reason: string;
}

function summaryOf(a: any): string {
  return a.personality_profile?.summary || a.bio || `${a.name}, a MOJOMO avatar with no profile yet.`;
}

/**
 * Find 1-3 avatars (other than `avatarId`) worth connecting `avatarId` with, either for a
 * specific request (`query` set) or for a general proactive suggestion (`query` null).
 */
export async function findMatches(avatarId: string, query: string | null): Promise<MatchCandidate[]> {
  const meRes = await db.query('SELECT * FROM mojomo.avatars WHERE id = $1', [avatarId]);
  if (meRes.rows.length === 0) throw new Error('Avatar not found');
  const me = meRes.rows[0];

  const candidatesRes = await db.query(
    `SELECT id, name, bio, personality_profile FROM mojomo.avatars
     WHERE id != $1
     ORDER BY (is_npc) DESC, updated_at DESC
     LIMIT 200`,
    [avatarId]
  );
  if (candidatesRes.rows.length === 0) return [];

  const candidateList = candidatesRes.rows
    .map((c: any) => `- id: ${c.id} | name: ${c.name} | about: ${summaryOf(c)}`)
    .join('\n');

  const system = `You are the matchmaking engine for MOJOMO, a platform where every person's AI avatar can connect with other avatars on their behalf. Given one avatar's profile and a list of candidate avatars, pick the 1-3 best matches and explain why in one sentence each. Respond in valid JSON only: {"matches": [{"avatar_id": "...", "name": "...", "reason": "..."}]}. If nothing is a good match, return {"matches": []}.`;

  const userContent = `Requesting avatar: ${me.name} - ${summaryOf(me)}

${query ? `They are specifically looking for: ${query}` : 'They have not asked for anything specific - suggest a generally interesting connection based on shared ground.'}

Candidates:
${candidateList}`;

  try {
    const result = await complete({ system, user: userContent, maxTokens: 512, json: true });
    let t = result.text.trim();
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start === -1 || end === -1) return [];
    const parsed = JSON.parse(t.slice(start, end + 1));
    const matches: MatchCandidate[] = Array.isArray(parsed.matches) ? parsed.matches : [];
    // Guard against the model inventing an id that isn't a real candidate.
    const validIds = new Set(candidatesRes.rows.map((c: any) => c.id));
    return matches.filter((m) => validIds.has(m.avatar_id)).slice(0, 3);
  } catch (err) {
    console.error(`findMatches failed for avatar ${avatarId}:`, err);
    return [];
  }
}

/** Proactive sweep: for one avatar, look for a good general match and record a hint if found. */
export async function runProactiveMatchForAvatar(avatarId: string): Promise<boolean> {
  const existing = await db.query(
    `SELECT 1 FROM mojomo.avatar_hints WHERE avatar_id = $1 AND status = 'pending' LIMIT 1`,
    [avatarId]
  );
  if (existing.rows.length > 0) return false; // don't pile up unread hints

  const matches = await findMatches(avatarId, null);
  if (matches.length === 0) return false;
  const top = matches[0];
  await db.query(
    `INSERT INTO mojomo.avatar_hints (avatar_id, suggested_avatar_id, reason) VALUES ($1, $2, $3)`,
    [avatarId, top.avatar_id, top.reason]
  );
  return true;
}

let proactiveTimer: ReturnType<typeof setInterval> | null = null;

/** Periodically run a proactive-match pass across all human (non-NPC) avatars. */
export function startProactiveMatchScheduler(
  intervalMs: number = Number(process.env.PROACTIVE_MATCH_INTERVAL_MS || 24 * 60 * 60 * 1000)
): void {
  if (proactiveTimer) return;
  const run = async () => {
    try {
      const avatars = await db.query(`SELECT id FROM mojomo.avatars WHERE is_npc = false`);
      let created = 0;
      for (const { id } of avatars.rows) {
        if (await runProactiveMatchForAvatar(id).catch(() => false)) created++;
      }
      if (created > 0) console.log(`Proactive matchmaking sweep: created ${created} hint(s)`);
    } catch (e) {
      console.error('Proactive matchmaking sweep failed:', e);
    }
  };
  proactiveTimer = setInterval(run, intervalMs);
  console.log(`Proactive matchmaking scheduler: every ${Math.round(intervalMs / 3600000)}h`);
}

export function stopProactiveMatchScheduler(): void {
  if (proactiveTimer) { clearInterval(proactiveTimer); proactiveTimer = null; }
}

export default { findMatches, runProactiveMatchForAvatar, startProactiveMatchScheduler, stopProactiveMatchScheduler };
