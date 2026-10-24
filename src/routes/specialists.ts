// Specialist API endpoints
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { hideTokenFields, specialistsEnabled, tokensEnabled } from '../config/features';
import { joinConversationAsSpecialist } from '../services/specialists';
import * as conversationService from '../services/conversations';

const router = Router();
router.use(hideTokenFields);

const JoinSpecialistSchema = z.object({
  specialist_avatar_id: z.string().uuid(),
});

/**
 * POST /conversations/:id/specialists - Add specialist to conversation
 * Body: { specialist_avatar_id }
 */
router.post('/conversations/:id/specialists', async (req: Request, res: Response) => {
  // Specialists / late joiners are LIVE in production as of 2026-10-24 (SPECIALISTS_ENABLED=true).
  // The flag remains as an operational switch: set SPECIALISTS_ENABLED=false to disable joins
  // without a code change. Dilution is part of the token economy, so TOKENS_ENABLED must also be on.
  if (!specialistsEnabled() || !tokensEnabled()) {
    return res.status(403).json({
      error: 'Specialist joins are currently disabled',
      roadmap: 'Specialist joins are live but switched off on this deployment. Set SPECIALISTS_ENABLED=true (and TOKENS_ENABLED=true) to enable them.',
    });
  }
  try {
    const { id } = req.params;
    const payload = JoinSpecialistSchema.parse(req.body);

    // Verify conversation exists
    const conversation = await conversationService.getConversation(id);

    // Verify specialist avatar exists (optional - DB will catch if it doesn't)
    // In production, you'd verify this first to give better error message

    // Execute specialist join
    const result = await joinConversationAsSpecialist(id, payload.specialist_avatar_id);

    res.status(201).json(result);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }

    if (error.message.includes('not found')) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    if (error.message.includes('already in')) {
      return res.status(400).json({
        error: 'Specialist already in conversation',
      });
    }

    if (error.message.includes('race condition')) {
      return res.status(409).json({
        error: 'Specialist join in progress. Please retry in a moment.',
      });
    }

    if (error.message.includes('Serialization failure')) {
      return res.status(409).json({
        error: 'Concurrent join detected. Please retry.',
      });
    }

    if (error.message && error.message.includes('has ended')) {

      return res.status(409).json({ error: error.message });

    }

    console.error('Error joining specialist:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /conversations/:id/participants - List all participants with ownership
 * Returns both core participants (A, B) and specialists
 */
router.get('/conversations/:id/participants', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const conversation = await conversationService.getConversation(id);

    const participants = Object.entries(conversation.ownership_ledger).map(
      ([avatar_id, data]: [string, any]) => ({
        avatar_id,
        ownership_pct: data.ownership_pct,
        token_balance: data.token_balance,
        vested_pct: data.vested_pct,
        join_round: data.join_round || 0,
        is_initiator: avatar_id === conversation.initiator_avatar_id,
        is_target: avatar_id === conversation.target_avatar_id,
        is_specialist: (data.join_round || 0) > 0,
      })
    );

    res.json({
      conversation_id: id,
      total_participants: participants.length,
      participants: participants.sort((a, b) => (a.join_round || 0) - (b.join_round || 0)),
    });
  } catch (error: any) {
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    console.error('Error fetching participants:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
