// Periodic housekeeping for decision requests.
//
// Two jobs: expire requests nobody answered, and retry the Telegram ping for
// urgent requests whose notification never landed (process restart, API blip).
import * as db from './db';
import * as decisions from './decisionRequests';
import * as notify from './decisionNotify';

export async function sweep(): Promise<{ expired: number; pinged: number }> {
  const expired = await decisions.expireStale();

  // Urgent, still-pending, created in the last 6 hours, never notified.
  const missed = await db.query(
    `SELECT * FROM agent.decision_requests
      WHERE urgency='high' AND status='pending'
        AND notified_at IS NULL
        AND created_at > now() - interval '6 hours'
      LIMIT 20`
  );

  let pinged = 0;
  for (const r of missed.rows) {
    const ok = await notify.notifyIfUrgent(r).catch(() => false);
    if (ok) {
      await db.query(`UPDATE agent.decision_requests SET notified_at=now() WHERE id=$1`, [r.id]);
      pinged++;
    }
  }
  return { expired, pinged };
}
