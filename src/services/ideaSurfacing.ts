// Surface matured ideas to the humans behind the avatars that produced them.
//
// When an idea reaches 'mature', every user whose avatar took part in the conversation gets one
// email: "log in, read this, tell us whether you want to carry it on." The ask is recorded in
// idea_agreements so nobody is emailed twice about the same idea, and so the answer is durable.
//
// Deliberately separate from ideaMaturation: maturation decides *when* an idea is ready, this
// decides *who to tell* and records what they said.
import * as db from './db';
import * as mailer from './mailer';
import { publicUrl } from './auth';

export interface SurfacedIdea {
  idea_id: string;
  title: string;
  full_hypothesis: string;
  conversation_id: string;
  notified: number;
  skipped: number;
}

/**
 * Notify participants about one matured idea. Idempotent: users already asked are skipped.
 * Returns counts rather than throwing so a mail failure can't fail the maturation sweep.
 */
export async function surfaceIdea(ideaId: string): Promise<SurfacedIdea> {
  const ideaRes = await db.query(
    `SELECT id, conversation_id, title, full_hypothesis, maturity_stage
     FROM mojomo.idea_repository WHERE id = $1`,
    [ideaId]
  );
  if (ideaRes.rows.length === 0) throw new Error('Idea not found');
  const idea = ideaRes.rows[0];
  if (idea.maturity_stage !== 'mature') {
    throw new Error(`Idea is ${idea.maturity_stage}, not mature; refusing to surface`);
  }

  // Everyone whose avatar is in the conversation, with their email.
  const people = await db.query(
    `SELECT DISTINCT u.id AS user_id, u.email
     FROM mojomo.conversations c
     JOIN mojomo.avatars a
       ON a.id = c.initiator_avatar_id
       OR a.id = c.target_avatar_id
       OR a.id = ANY(c.participant_avatar_ids)
     JOIN mojomo.users u ON u.id = a.user_id
     WHERE c.id = $1`,
    [idea.conversation_id]
  );

  const url = `${publicUrl()}/?idea=${encodeURIComponent(ideaId)}`;
  let notified = 0;
  let skipped = 0;

  for (const person of people.rows) {
    // Claim the ask first: the unique index makes this the concurrency-safe gate, so a
    // double sweep can't send two emails.
    const claim = await db.query(
      `INSERT INTO mojomo.idea_agreements (idea_id, user_id, status)
       VALUES ($1, $2, 'pending')
       ON CONFLICT (idea_id, user_id) DO NOTHING
       RETURNING id`,
      [ideaId, person.user_id]
    );
    if (claim.rows.length === 0) { skipped += 1; continue; }

    const sent = await mailer.sendIdeaSurfacedEmail(person.email, idea.title, idea.full_hypothesis, url);
    if (sent.accepted) {
      await db.query(`UPDATE mojomo.idea_agreements SET notified_at = NOW(), updated_at = NOW() WHERE id = $1`, [claim.rows[0].id]);
      notified += 1;
    } else {
      // Delivery failed: drop the claim so a later sweep can retry rather than silently
      // leaving the person un-notified forever.
      await db.query(`DELETE FROM mojomo.idea_agreements WHERE id = $1`, [claim.rows[0].id]);
      console.error(`Idea ${ideaId}: could not notify ${person.email} (${sent.detail || 'unknown'})`);
    }
  }

  return {
    idea_id: ideaId,
    title: idea.title,
    full_hypothesis: idea.full_hypothesis,
    conversation_id: idea.conversation_id,
    notified,
    skipped,
  };
}

/** Surface every matured idea that still has someone un-asked. Bounded for the job queue. */
export async function surfacePendingIdeas(limit = 25): Promise<SurfacedIdea[]> {
  const rows = await db.query(
    `SELECT i.id
     FROM mojomo.idea_repository i
     WHERE i.maturity_stage = 'mature'
       AND EXISTS (
         SELECT 1 FROM mojomo.conversations c
         JOIN mojomo.avatars a
           ON a.id = c.initiator_avatar_id
           OR a.id = c.target_avatar_id
           OR a.id = ANY(c.participant_avatar_ids)
         JOIN mojomo.users u ON u.id = a.user_id
         WHERE c.id = i.conversation_id
           AND NOT EXISTS (
             SELECT 1 FROM mojomo.idea_agreements g
             WHERE g.idea_id = i.id AND g.user_id = u.id
           )
       )
     ORDER BY i.surfaced_at ASC NULLS FIRST
     LIMIT $1`,
    [limit]
  );

  const out: SurfacedIdea[] = [];
  for (const row of rows.rows) {
    try {
      out.push(await surfaceIdea(row.id));
    } catch (err: any) {
      console.error(`Surfacing failed for idea ${row.id}:`, err.message);
    }
  }
  return out;
}

export type AgreementStatus = 'pending' | 'accepted' | 'declined';

/** Record a person's answer to "do you want to carry this on?" */
export async function respondToIdea(
  ideaId: string,
  userId: string,
  status: Exclude<AgreementStatus, 'pending'>
): Promise<{ idea_id: string; status: AgreementStatus }> {
  const r = await db.query(
    `UPDATE mojomo.idea_agreements
     SET status = $1, responded_at = NOW(), updated_at = NOW()
     WHERE idea_id = $2 AND user_id = $3
     RETURNING status`,
    [status, ideaId, userId]
  );
  if (r.rows.length === 0) throw new Error('No agreement request found for this idea');
  return { idea_id: ideaId, status: r.rows[0].status };
}

/** Ideas awaiting this person's decision - what the portal shows them on login. */
export async function listAgreementsForUser(userId: string): Promise<any[]> {
  const r = await db.query(
    `SELECT g.idea_id, g.status, g.notified_at, g.responded_at,
            i.title, i.full_hypothesis, i.confidence_score, i.maturity_stage, i.conversation_id
     FROM mojomo.idea_agreements g
     JOIN mojomo.idea_repository i ON i.id = g.idea_id
     WHERE g.user_id = $1
     ORDER BY (g.status = 'pending') DESC, g.created_at DESC
     LIMIT 100`,
    [userId]
  );
  return r.rows;
}

export default { surfaceIdea, surfacePendingIdeas, respondToIdea, listAgreementsForUser };
