// Payout API endpoints
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as payoutService from '../services/payouts';

const router = Router();

const InitiatePayoutSchema = z.object({
  avatar_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  token_amount: z.number().positive(),
  payment_method: z.string().optional(),
});

/**
 * GET /conversations/:id/avatars/:avatar_id/vesting - Get vesting status
 */
router.get('/conversations/:id/avatars/:avatar_id/vesting', async (req: Request, res: Response) => {
  try {
    const { id, avatar_id } = req.params;

    const vesting = await payoutService.getVestingStatus(avatar_id, id);

    res.json({
      avatar_id,
      conversation_id: id,
      total_tokens: vesting.total_token_amount,
      vested_pct: vesting.vested_pct,
      available_tokens: vesting.available_tokens,
      locked_tokens: vesting.locked_tokens,
      paid_out_tokens: vesting.paid_out_tokens ?? 0,
      vesting_end_date: vesting.vesting_end_date,
      days_elapsed: vesting.days_elapsed,
      days_remaining: Math.max(
        0,
        Math.ceil(
          (vesting.vesting_end_date.getTime() - new Date().getTime()) / (24 * 60 * 60 * 1000)
        )
      ),
      genesis_or_bought: vesting.genesis_or_bought,
    });
  } catch (error: any) {
    if (error.message.includes('not found') || error.message.includes('not in conversation')) {
      return res.status(404).json({ error: 'Conversation or avatar not found' });
    }
    console.error('Error fetching vesting status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /payouts/initiate - Initiate a payout
 * Body: { avatar_id, conversation_id, token_amount, payment_method? }
 */
router.post('/payouts/initiate', async (req: Request, res: Response) => {
  try {
    const payload = InitiatePayoutSchema.parse(req.body);

    const payout = await payoutService.initiatePayout(
      payload.avatar_id,
      payload.conversation_id,
      payload.token_amount,
      payload.payment_method
    );

    res.status(201).json(payout);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }

    if (error.message.includes('not found') || error.message.includes('not in conversation')) {
      return res.status(404).json({ error: 'Conversation or avatar not found' });
    }
    if (
      error.message.includes('Insufficient vested') ||
      error.message.includes('positive') ||
      error.message.includes('Race condition')
    ) {
      return res.status(400).json({ error: error.message });
    }

    console.error('Error initiating payout:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /payouts/:id - Get payout details
 */
router.get('/payouts/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const payout = await payoutService.getPayout(id);
    res.json(payout);
  } catch (error: any) {
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: 'Payout not found' });
    }
    console.error('Error fetching payout:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /conversations/:id/payouts - List payouts for conversation
 */
router.get('/conversations/:id/payouts', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const payouts = await payoutService.listPayouts(id, limit, offset);

    res.json({
      conversation_id: id,
      total_count: payouts.length,
      payouts,
    });
  } catch (error: any) {
    console.error('Error listing payouts:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
