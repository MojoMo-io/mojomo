// Compliance evidence surface.
//
// EU AI Act Art 19 requires automatically generated logs over the lifetime of
// the system. Art 26 requires deployers to keep records of oversight activity.
// This exposes the decision event chain so an auditor can verify it has not
// been altered, and export one decision's full oversight trail.
import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import * as decisionEvents from '../services/decisionEvents';
import * as db from '../services/db';

const router = Router();

/** Verify the whole chain. Admin only. */
router.get('/compliance/chain/verify', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const result = await decisionEvents.verifyChain();
    res.status(result.ok ? 200 : 409).json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

/** Full oversight trail for one decision. Admin only. */
router.get('/compliance/decision/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const trail = await decisionEvents.trailFor(req.params.id);
    if (!trail.length) return res.status(404).json({ error: 'No events for that decision.' });
    const reqRow = await db.query(
      `SELECT id, agent_id, tether_user_id, kind, title, status, answer, answered_at, created_at, expires_at
         FROM agent.decision_requests WHERE id=$1`,
      [req.params.id]
    );
    res.json({ decision: reqRow.rows[0] ?? null, trail });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/** Counts for a dashboard. Admin only. */
router.get('/compliance/summary', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const r = await db.query(
      `SELECT event, count(*)::int AS n FROM agent.decision_events GROUP BY event ORDER BY event`
    );
    const total = await db.query(`SELECT count(*)::int AS n FROM agent.decision_events`);
    res.json({ total: total.rows[0]?.n ?? 0, by_event: r.rows });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
