// Conversation ending API endpoints
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as forfeitureService from '../services/forfeiture';

const router = Router();

const EndConversationSchema = z.object({
  avatar_id: z.string().uuid(),
});

/**
 * POST /conversations/:id/end - End conversation with forfeiture
 */
router.post('/conversations/:id/end', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const payload = EndConversationSchema.parse(req.body);

    const result = await forfeitureService.endConversation(
      id,
      payload.avatar_id,
      'ended_by_initiator'
    );

    res.json(result);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }

    if (error.message.includes('not found')) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    if (error.message.includes('Only initiator')) {
      return res.status(403).json({ error: error.message });
    }

    console.error('Error ending conversation:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /conversations/:id/forfeiture-status - Get forfeiture calculation without ending
 */
router.get('/conversations/:id/forfeiture-status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const { vested_pct, forfeiture_breakdown } =
      await forfeitureService.calculateConversationVesting(id);

    const total_forfeited = forfeiture_breakdown.reduce(
      (sum: number, entry: any) => sum + entry.forfeited_tokens,
      0
    );

    res.json({
      conversation_id: id,
      vested_pct,
      will_forfeit: total_forfeited > 0,
      total_forfeited,
      forfeiture_breakdown,
    });
  } catch (error: any) {
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    console.error('Error calculating forfeiture:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
