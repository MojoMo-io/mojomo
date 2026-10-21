// Support-dashboard API (support.mojomo.io). Mounted after requireAuth + enforceOwnership like
// everything else, but every route here also requires requireAdmin. Intentionally does NOT apply
// hideTokenFields - admin should always see real ledger numbers even while TOKENS_ENABLED is off
// for the public.
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as db from '../services/db';
import { requireAdmin } from '../middleware/auth';
import * as conversationService from '../services/conversations';
import { queueAvatarReplyJob } from '../services/job-queue';
import { INTERNAL_PLACEHOLDER_TOKENS } from '../config/features';

const router = Router();
router.use('/admin', requireAdmin);

/** GET /admin/users - all users with their avatar count. */
router.get('/admin/users', async (req: Request, res: Response) => {
  const result = await db.query(
    `SELECT u.id, u.email, u.is_admin, u.created_at, COUNT(a.id)::int AS avatar_count
     FROM mojomo.users u LEFT JOIN mojomo.avatars a ON a.user_id = u.id
     GROUP BY u.id ORDER BY u.created_at DESC LIMIT 200`
  );
  res.json(result.rows);
});

/** GET /admin/users/:id - one user plus their avatars. */
router.get('/admin/users/:id', async (req: Request, res: Response) => {
  const user = await db.query('SELECT id, email, is_admin, created_at FROM mojomo.users WHERE id = $1', [req.params.id]);
  if (user.rows.length === 0) return res.status(404).json({ error: 'User not found' });
  const avatars = await db.query('SELECT * FROM mojomo.avatars WHERE user_id = $1 ORDER BY created_at ASC', [req.params.id]);
  res.json({ user: user.rows[0], avatars: avatars.rows });
});

const UpdateAvatarSchema = z.object({
  bio: z.string().max(1000).optional(),
  system_prompt: z.string().max(4000).optional(),
});

/** PATCH /admin/avatars/:id - edit bio/system_prompt for any avatar (human or NPC). */
router.patch('/admin/avatars/:id', async (req: Request, res: Response) => {
  const payload = UpdateAvatarSchema.parse(req.body);
  const fields: string[] = [];
  const values: any[] = [];
  let i = 1;
  for (const [k, v] of Object.entries(payload)) {
    fields.push(`${k} = $${i++}`);
    values.push(v);
  }
  if (fields.length === 0) return res.status(400).json({ error: 'Nothing to update' });
  values.push(req.params.id);
  const result = await db.query(
    `UPDATE mojomo.avatars SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${i} RETURNING *`,
    values
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Avatar not found' });
  res.json(result.rows[0]);
});

/** GET /admin/avatars/:id/ledger - this avatar's ownership across every conversation it's in. */
router.get('/admin/avatars/:id/ledger', async (req: Request, res: Response) => {
  const result = await db.query(
    `SELECT id, title, status, ownership_ledger -> $1 AS entry, created_at
     FROM mojomo.conversations WHERE initiator_avatar_id = $1 OR target_avatar_id = $1
     ORDER BY created_at DESC`,
    [req.params.id]
  );
  res.json(result.rows);
});

const CreateNpcAvatarSchema = z.object({
  name: z.string().min(2).max(255),
  bio: z.string().max(1000).optional(),
  system_prompt: z.string().min(20).max(4000),
  is_support: z.boolean().optional().default(false),
});

/** POST /admin/npc-avatars - create a new house-owned NPC/public-figure avatar. Reusable, not one-off. */
router.post('/admin/npc-avatars', async (req: Request, res: Response) => {
  try {
    const payload = CreateNpcAvatarSchema.parse(req.body);
    const houseUser = await db.query(`SELECT id FROM mojomo.users WHERE email = $1`, [process.env.HOUSE_USER_EMAIL || 'house@mojomo.io']);
    if (houseUser.rows.length === 0) return res.status(500).json({ error: 'House user is not seeded yet' });

    // A lightweight profile so matchmaking has something to compare against even before any
    // admin-authored personality_profile exists - bio if given, else a snippet of the system prompt.
    const profile = { interests: [], specialisms: [], values: [], communication_style: '', summary: payload.bio || payload.system_prompt.slice(0, 400) };

    const result = await db.query(
      `INSERT INTO mojomo.avatars (user_id, name, bio, avatar_type, is_npc, is_support, system_prompt, personality_profile)
       VALUES ($1, $2, $3, 'individual', true, $4, $5, $6) RETURNING *`,
      [houseUser.rows[0].id, payload.name, payload.bio || null, payload.is_support, payload.system_prompt, JSON.stringify(profile)]
    );
    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Validation failed', details: error.errors });
    console.error('Error creating NPC avatar:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** GET /admin/npc-avatars - list every house-owned avatar (same data as the public endpoint, plus system_prompt). */
router.get('/admin/npc-avatars', async (req: Request, res: Response) => {
  const result = await db.query(`SELECT * FROM mojomo.avatars WHERE is_npc = true ORDER BY is_support ASC, name ASC`);
  res.json(result.rows);
});

const SupportConversationSchema = z.object({ user_avatar_id: z.string().uuid() });

/** POST /admin/support-conversations - launch a support-avatar conversation with a user's avatar. */
router.post('/admin/support-conversations', async (req: Request, res: Response) => {
  try {
    const payload = SupportConversationSchema.parse(req.body);
    const supportAvatar = await db.query(`SELECT id FROM mojomo.avatars WHERE is_support = true LIMIT 1`);
    if (supportAvatar.rows.length === 0) return res.status(500).json({ error: 'No support avatar exists yet - create one via POST /admin/npc-avatars with is_support: true' });

    const conversation = await conversationService.createConversation(
      supportAvatar.rows[0].id,
      payload.user_avatar_id,
      'MOJOMO Support',
      INTERNAL_PLACEHOLDER_TOKENS
    );
    await queueAvatarReplyJob(conversation.id, supportAvatar.rows[0].id);
    res.status(201).json(conversation);
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Validation failed', details: error.errors });
    console.error('Error starting support conversation:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** GET /admin/conversations/:id/messages - watch any conversation, not just ones admin participates in. */
router.get('/admin/conversations/:id/messages', async (req: Request, res: Response) => {
  const result = await db.query(
    `SELECT * FROM mojomo.conversation_messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
    [req.params.id]
  );
  res.json(result.rows);
});

/** GET /admin/hints - every pending hint platform-wide, for visibility into the matchmaking engine. */
router.get('/admin/hints', async (req: Request, res: Response) => {
  const result = await db.query(
    `SELECT h.*, a1.name AS avatar_name, a2.name AS suggested_avatar_name
     FROM mojomo.avatar_hints h
     JOIN mojomo.avatars a1 ON a1.id = h.avatar_id
     JOIN mojomo.avatars a2 ON a2.id = h.suggested_avatar_id
     ORDER BY h.created_at DESC LIMIT 100`
  );
  res.json(result.rows);
});

export default router;
