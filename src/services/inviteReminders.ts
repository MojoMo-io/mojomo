// Sprint 13, Task 2: the reminder sequence.
//
// The funnel was register -> 1 email -> silence -> expire. One email is not a
// handoff, it is a hope. This sweeper adds two nudges and an expiry notice, then
// stops forever.
//
// Design decisions worth keeping:
//
//   * Hard cap of 3 emails per invitation, enforced by the reminders_sent
//     counter rather than by trusting the query. A bug in the WHERE clause must
//     not turn into a human being mailed every 15 minutes.
//
//   * The 24h nudge is skipped if the human already opened the link. Someone who
//     clicked and did not accept does not need "still waiting" - they need the
//     deadline, which is the 60h email. Sending both is how you train a human to
//     ignore you.
//
//   * The expiry notice carries no link. The link is dead; offering it is a lie.
//
//   * Every send is recorded in the funnel with its stage, so conversion can be
//     measured per touch rather than in aggregate.
import * as db from './db';
import * as funnel from './funnel';
import { sendInviteReminderEmail } from './mailer';
import { publicUrl, createClaimToken } from './agents';

export const MAX_REMINDERS = 3;

type Stage = 'nudge' | 'final' | 'expired';

interface Candidate {
  id: string;
  agent_id: string;
  human_email: string;
  token_hash: string;
  expires_at: Date;
  created_at: Date;
  opened_at: Date | null;
  reminders_sent: number;
  display_name: string;
  handle: string;
  description: string | null;
  operator_name: string | null;
  model_family: string | null;
}

/**
 * Which reminder, if any, is due for this invitation right now.
 *
 * Pure so it can be tested without a database or a clock.
 */
export function dueStage(inv: {
  created_at: Date;
  expires_at: Date;
  opened_at: Date | null;
  reminders_sent: number;
}, now: Date = new Date()): Stage | null {
  if (inv.reminders_sent >= MAX_REMINDERS) return null;

  const ageH = (now.getTime() - inv.created_at.getTime()) / 3_600_000;
  const expired = now.getTime() >= inv.expires_at.getTime();

  // Expiry notice. The MAX_REMINDERS guard above already stops us at three
  // emails, so this is simply the last one.
  if (expired) return 'expired';

  // 60h: the deadline is real. Send whether or not they opened it.
  if (ageH >= 60 && inv.reminders_sent < 2) return 'final';

  // 24h: only if they have not already looked.
  if (ageH >= 24 && inv.reminders_sent < 1 && !inv.opened_at) return 'nudge';

  return null;
}

async function candidates(limit = 50): Promise<Candidate[]> {
  const r = await db.query(
    `SELECT i.id, i.agent_id, i.human_email, i.token_hash, i.expires_at, i.created_at,
            i.opened_at, i.reminders_sent,
            a.display_name, a.handle, a.description, a.operator_name, a.model_family
       FROM agent.invitations i
       JOIN agent.agents a ON a.id = i.agent_id
      WHERE i.status = 'pending'
        AND i.reminders_sent < $1
        AND (i.created_at < now() - interval '24 hours')
      ORDER BY i.created_at ASC
      LIMIT $2`,
    [MAX_REMINDERS, limit]
  );
  return r.rows as Candidate[];
}

export async function sweep(now: Date = new Date()): Promise<{ sent: number; skipped: number }> {
  const rows = await candidates();
  let sent = 0;
  let skipped = 0;

  for (const inv of rows) {
    const stage = dueStage(inv, now);
    if (!stage) { skipped++; continue; }

    // The raw invite token is never stored - only its hash - so a reminder
    // cannot reuse the original link. Instead we mint a fresh single-use claim
    // token and address the invitation by id. The id is not a secret; the claim
    // token is the proof, and it only ever travels to the named human's inbox.
    const claim = await createClaimToken(inv.id);
    const url = `${publicUrl()}/agent/claim?id=${inv.id}&claim=${claim.token}`;

    const result = await sendInviteReminderEmail(inv.human_email, {
      stage,
      agentName: inv.display_name,
      handle: inv.handle,
      description: inv.description,
      operatorName: inv.operator_name,
      modelFamily: inv.model_family,
      url,
      expiresAt: inv.expires_at,
    }).catch(() => ({ accepted: false } as any));

    if (!result?.accepted) { skipped++; continue; }

    await db.query(
      `UPDATE agent.invitations
          SET reminders_sent = reminders_sent + 1,
              last_reminded_at = now(),
              expired_notified_at = CASE WHEN $2 = 'expired' THEN now() ELSE expired_notified_at END
        WHERE id = $1`,
      [inv.id, stage]
    );

    await funnel.emit('reminder_sent', {
      agent_id: inv.agent_id,
      invitation_id: inv.id,
      handle: inv.handle,
      detail: { stage, opened: !!inv.opened_at, reminders_sent: inv.reminders_sent + 1 },
    });

    sent++;
  }

  return { sent, skipped };
}
