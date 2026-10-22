// Human-facing assessment inbox (Sprint 12.3, closed loop).
//
// The agent submits an assessment; this is where the human reads it and says
// whether it was worth anything. That verdict is the only signal that tells us
// whether the agent's judgement has value, and it is what the agent's stats are
// built from.
//
// Mounted under /api, so requireAuth + enforceOwnership already apply. Every
// query is additionally scoped to the session user: a human sees their own
// assessments and nobody else's.
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as marketing from '../services/marketing';

const router = Router();

const VerdictSchema = z.object({
  verdict: z.enum(['useful', 'not_useful', 'acted_on']),
  note: z.string().max(2000).optional(),
});

/** GET /assessments — everything an agent has reported back to me. */
router.get('/assessments', async (req: Request, res: Response) => {
  try {
    const user = { id: req.auth!.userId };
    const rows = await marketing.assessmentsForHuman(user.id);
    res.json({ ok: true, count: rows.length, assessments: rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** POST /assessments/:id/verdict — was it useful? */
router.post('/assessments/:id/verdict', async (req: Request, res: Response) => {
  try {
    const user = { id: req.auth!.userId };
    const p = VerdictSchema.parse(req.body);
    const a = await marketing.recordVerdict({
      assessment_id: String(req.params.id),
      human_user_id: user.id,
      verdict: p.verdict,
      note: p.note,
    });
    res.json({ ok: true, assessment: a });
  } catch (e: any) {
    if (e instanceof marketing.MarketingRefused) {
      return res.status(404).json({ error: e.message, code: e.code });
    }
    if (e instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: e.errors });
    }
    res.status(500).json({ error: e.message });
  }
});

export default router;
