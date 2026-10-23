// Human-facing decision-request endpoints. Session auth.
import { Router, Request, Response } from 'express';
import * as decisions from '../services/decisionRequests';

const router = Router();

/** GET /api/decisions — everything addressed to me. */
router.get('/decisions', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).auth.userId;
    const includeAnswered = req.query.all === '1';
    const rows = await decisions.listForUser(userId, { includeAnswered });
    const pending = await decisions.pendingCount(userId);
    res.json({ ok: true, pending, requests: rows });
  } catch (e: any) {
    console.error('decisions list failed:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** POST /api/decisions/:id/answer  { answer, note? } */
router.post('/decisions/:id/answer', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).auth.userId;
    const r = await decisions.answer({
      id: String(req.params.id),
      userId,
      answer: req.body?.answer,
      note: req.body?.note,
    });
    res.json({ ok: true, request: r });
  } catch (e: any) {
    if (e instanceof decisions.DecisionError) {
      return res.status(e.status).json({ error: e.message, code: e.code });
    }
    console.error('decision answer failed:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
