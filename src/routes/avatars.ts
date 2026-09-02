// Avatar API endpoints
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import * as db from '../services/db';
import { verifyTelegramChat } from '../services/telegram';
import { Avatar, CreateAvatarPayload, UpdateAvatarTelegramPayload } from '../types';

const router = Router();

// Validation schemas
const CreateAvatarSchema = z.object({
  name: z.string().min(2).max(255),
  bio: z.string().max(1000).optional(),
  avatar_type: z.enum(['individual', 'specialist', 'collective']).default('individual'),
  telegram_chat_id: z.string().regex(/^\d+$/).optional(),
});

const UpdateAvatarTelegramSchema = z.object({
  telegram_chat_id: z.string().regex(/^\d+$/),
});

/**
 * POST /avatars - Create a new avatar
 * Body: { name, bio?, avatar_type?, telegram_chat_id? }
 */
router.post('/avatars', async (req: Request, res: Response) => {
  try {
    const payload = CreateAvatarSchema.parse(req.body);

    // For now, use a placeholder user_id (in real app, from JWT)
    const user_id = req.headers['x-user-id'] as string || uuidv4();

    let telegram_verified_at: Date | null = null;

    // Verify Telegram chat if provided
    if (payload.telegram_chat_id) {
      const verified = await verifyTelegramChat(payload.telegram_chat_id);
      if (verified) {
        telegram_verified_at = new Date();
      } else {
        console.warn(`Telegram verification failed for chat ${payload.telegram_chat_id}`);
        // Don't fail the request, just warn
      }
    }

    const result = await db.query(
      `INSERT INTO mojomo.avatars (
        id, user_id, name, bio, avatar_type, telegram_chat_id, telegram_verified_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        uuidv4(),
        user_id,
        payload.name,
        payload.bio || null,
        payload.avatar_type,
        payload.telegram_chat_id || null,
        telegram_verified_at,
      ]
    );

    const avatar = result.rows[0];
    res.status(201).json(avatar);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    console.error('Error creating avatar:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /avatars/:id - Get avatar by ID
 */
router.get('/avatars/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      'SELECT * FROM mojomo.avatars WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Avatar not found' });
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    console.error('Error fetching avatar:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /avatars - List avatars for authenticated user
 */
router.get('/avatars', async (req: Request, res: Response) => {
  try {
    const user_id = req.headers['x-user-id'] as string;

    if (!user_id) {
      return res.status(401).json({ error: 'User ID required in x-user-id header' });
    }

    const result = await db.query(
      'SELECT * FROM mojomo.avatars WHERE user_id = $1 ORDER BY created_at DESC',
      [user_id]
    );

    res.json(result.rows);
  } catch (error: any) {
    console.error('Error listing avatars:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /avatars/:id/telegram - Update Telegram chat for avatar
 * Body: { telegram_chat_id }
 */
router.patch('/avatars/:id/telegram', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const payload = UpdateAvatarTelegramSchema.parse(req.body);

    // Verify the chat first
    const verified = await verifyTelegramChat(payload.telegram_chat_id);
    if (!verified) {
      return res.status(400).json({
        error: 'Telegram chat could not be verified. Make sure the bot has access to the chat.',
      });
    }

    // Check avatar ownership (in real app, would check JWT)
    const avatarResult = await db.query(
      'SELECT * FROM mojomo.avatars WHERE id = $1',
      [id]
    );

    if (avatarResult.rows.length === 0) {
      return res.status(404).json({ error: 'Avatar not found' });
    }

    // Update avatar with verified telegram chat
    const result = await db.query(
      `UPDATE mojomo.avatars
       SET telegram_chat_id = $1, telegram_verified_at = NOW(), updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [payload.telegram_chat_id, id]
    );

    res.json(result.rows[0]);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    console.error('Error updating avatar telegram:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
