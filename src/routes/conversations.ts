// Conversation API endpoints
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as conversationService from '../services/conversations';

const router = Router();

// Validation schemas
const CreateConversationSchema = z.object({
  initiator_avatar_id: z.string().uuid(),
  target_avatar_id: z.string().uuid(),
  title: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  total_tokens: z.number().positive(),
});

/**
 * POST /conversations - Create a new conversation
 * Body: { initiator_avatar_id, target_avatar_id, title, total_tokens, description? }
 */
router.post('/conversations', async (req: Request, res: Response) => {
  try {
    const payload = CreateConversationSchema.parse(req.body);

    const conversation = await conversationService.createConversation(
      payload.initiator_avatar_id,
      payload.target_avatar_id,
      payload.title,
      payload.total_tokens,
      payload.description
    );

    res.status(201).json(conversation);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    if (error.message.includes('not found') || error.message.includes('not in')) {
      return res.status(404).json({ error: error.message });
    }
    if (error.message.includes('same avatar') || error.message.includes('positive')) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Error creating conversation:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /conversations/:id - Get conversation by ID
 */
router.get('/conversations/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const conversation = await conversationService.getConversation(id);
    res.json(conversation);
  } catch (error: any) {
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    console.error('Error fetching conversation:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /conversations - List conversations for authenticated user
 */
router.get('/conversations', async (req: Request, res: Response) => {
  try {
    const user_id = req.headers['x-user-id'] as string;

    if (!user_id) {
      return res.status(401).json({ error: 'User ID required in x-user-id header' });
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const conversations = await conversationService.listConversationsForUser(
      user_id,
      limit,
      offset
    );

    res.json(conversations);
  } catch (error: any) {
    console.error('Error listing conversations:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /conversations/:id/ownership - Get full ownership ledger
 */
router.get('/conversations/:id/ownership', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const conversation = await conversationService.getConversation(id);
    const is_valid = conversationService.validateOwnershipSum(conversation.ownership_ledger);

    if (!is_valid) {
      return res.status(500).json({
        error: 'Ownership ledger is invalid (does not sum to 100%)',
        ledger: conversation.ownership_ledger,
      });
    }

    res.json({
      conversation_id: id,
      total_tokens: conversation.total_tokens,
      ownership_ledger: conversation.ownership_ledger,
      is_valid,
    });
  } catch (error: any) {
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    console.error('Error fetching ownership:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /conversations/:id/avatars/:avatar_id/ownership - Get single avatar ownership
 */
router.get('/conversations/:id/avatars/:avatar_id/ownership', async (req: Request, res: Response) => {
  try {
    const { id, avatar_id } = req.params;

    const conversation = await conversationService.getConversation(id);

    if (!conversation.ownership_ledger[avatar_id]) {
      return res.status(404).json({ error: 'Avatar not in conversation' });
    }

    const ownership = conversation.ownership_ledger[avatar_id];
    const timestamp = new Date();

    // Calculate vesting
    const vesting_start = conversation.created_at;
    const vesting_end = new Date(vesting_start.getTime() + 30 * 24 * 60 * 60 * 1000);

    let vested_pct = 0;
    if (timestamp >= vesting_end) {
      vested_pct = 100;
    } else if (timestamp > vesting_start) {
      const elapsed_ms = timestamp.getTime() - vesting_start.getTime();
      const total_ms = vesting_end.getTime() - vesting_start.getTime();
      vested_pct = Math.round((elapsed_ms / total_ms) * 10000) / 100;
    }

    const total = ownership.token_balance;
    const available = Math.round((total * vested_pct) / 100 * 100) / 100;
    const locked = total - available;

    res.json({
      avatar_id,
      conversation_id: id,
      total_tokens: ownership.token_balance,
      ownership_pct: ownership.ownership_pct,
      vested_pct,
      available_tokens: available,
      locked_tokens: locked,
      vesting_end_date: vesting_end,
      genesis_or_bought: ownership.buy_in_amount > 0 ? 'bought' : 'genesis',
    });
  } catch (error: any) {
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    console.error('Error fetching avatar ownership:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
