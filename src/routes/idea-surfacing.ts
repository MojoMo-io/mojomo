// Surfaced-idea endpoints: what a person sees on login, and their "carry it on?" answer.
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as surfacing from '../services/ideaSurfacing';

const router = Router();

const RespondSchema = z.object({ status: z.enum(['accepted', 'declined']) });

/** GET /ideas/agreements - matured ideas awaiting (or answered by) the signed-in user. */
router.get('/ideas/agreements', async (req: Request, res: Response) => {
  try {
    const rows = await surfacing.listAgreementsForUser(req.auth!.userId);
    res.json(rows);
  } catch (error: any) {
    console.error('Error listing idea agreements:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** POST /ideas/:idea_id/agreement - accept or decline carrying the idea on. */
router.post('/ideas/:idea_id/agreement', async (req: Request, res: Response) => {
  try {
    const payload = RespondSchema.parse(req.body);
    const result = await surfacing.respondToIdea(req.params.idea_id, req.auth!.userId, payload.status);
    res.json(result);
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Validation failed', details: error.errors });
    if (/No agreement request found/.test(error.message)) return res.status(404).json({ error: 'Idea not found' });
    console.error('Error responding to idea:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
