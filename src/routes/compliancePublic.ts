// Public integrity surface. No session, no content.
//
// The whole claim of this product is that the decision log cannot be altered
// without detection. That claim is only worth anything if a third party can
// check it themselves. This endpoint returns counts and a head hash - enough
// to prove the chain is intact, nothing that discloses what was decided.
import { Router } from 'express';
import * as decisionEvents from '../services/decisionEvents';
import * as db from '../services/db';

const router = Router();

router.get('/compliance/public/verify', async (_req, res) => {
  try {
    const result = await decisionEvents.verifyChain();
    const head = await db.query(
      `SELECT row_hash, created_at FROM agent.decision_events ORDER BY id DESC LIMIT 1`
    );
    res.status(result.ok ? 200 : 409).json({
      ok: result.ok,
      events: result.checked,
      broken_at: result.brokenAt ?? null,
      head_hash: head.rows[0]?.row_hash ?? null,
      head_at: head.rows[0]?.created_at ?? null,
      checked_at: new Date().toISOString(),
    });
  } catch {
    res.status(500).json({ ok: false, error: 'verification unavailable' });
  }
});

export default router;
