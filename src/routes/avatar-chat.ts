// Private chat between a human and their own avatar - the only place raw human typing happens.
// Also where matchmaking gets triggered ("find_match" intent) and where a hint gets accepted.
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as db from '../services/db';
import * as auth from '../services/auth';
import { generateAssistantReply } from '../services/avatarChat';
import { handleHumanMessage, startMatchedConversation } from '../services/avatarAssistant';
import { Avatar } from '../types';

const router = Router();

const ChatMessageSchema = z.object({ message: z.string().min(1).max(4000) });

async function requireOwnAvatar(req: Request, res: Response): Promise<Avatar | null> {
  const { id } = req.params;
  if (!(await auth.ownsAvatar(req.auth!.userId, id))) {
    res.status(404).json({ error: 'Avatar not found' });
    return null;
  }
  const result = await db.query('SELECT * FROM mojomo.avatars WHERE id = $1', [id]);
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Avatar not found' });
    return null;
  }
  return result.rows[0];
}

/** GET /avatars/:id/chat - private chat history; synthesizes a first greeting if empty. */
router.get('/avatars/:id/chat', async (req: Request, res: Response) => {
  try {
    const avatar = await requireOwnAvatar(req, res);
    if (!avatar) return;

    const history = await db.query(
      `SELECT id, role, content, source, created_at FROM mojomo.avatar_direct_messages
       WHERE avatar_id = $1 ORDER BY created_at ASC LIMIT 200`,
      [avatar.id]
    );

    if (history.rows.length === 0) {
      const { visibleReply } = await generateAssistantReply(avatar, []);
      const inserted = await db.query(
        `INSERT INTO mojomo.avatar_direct_messages (avatar_id, role, content, source) VALUES ($1, 'avatar', $2, 'web') RETURNING id, role, content, source, created_at`,
        [avatar.id, visibleReply]
      );
      return res.json({ avatar_id: avatar.id, messages: inserted.rows });
    }

    res.json({ avatar_id: avatar.id, messages: history.rows });
  } catch (error: any) {
    console.error('Error fetching avatar chat:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** POST /avatars/:id/chat - send a message to your own avatar; returns its reply synchronously. */
router.post('/avatars/:id/chat', async (req: Request, res: Response) => {
  try {
    const avatar = await requireOwnAvatar(req, res);
    if (!avatar) return;
    const payload = ChatMessageSchema.parse(req.body);

    const { reply, connection } = await handleHumanMessage(avatar, payload.message, 'web');
    res.status(201).json({ reply, connection });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Validation failed', details: error.errors });
    console.error('Error in avatar chat:', error);
    // The model call failed outright (no fallback text is stored). Tell the client it's
    // retryable rather than a generic 500, so the UI can say "try again" honestly.
    if (error?.message && /DeepSeek|Anthropic|LLM|No text response/i.test(error.message)) {
      return res.status(503).json({ error: 'Your avatar could not respond just now. Please try again in a moment.' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** GET /avatars/:id/hints - pending proactive suggestions for this avatar. */
router.get('/avatars/:id/hints', async (req: Request, res: Response) => {
  try {
    const avatar = await requireOwnAvatar(req, res);
    if (!avatar) return;
    const hints = await db.query(
      `SELECT h.id, h.reason, h.status, h.created_at, a.id AS suggested_avatar_id, a.name AS suggested_avatar_name
       FROM mojomo.avatar_hints h JOIN mojomo.avatars a ON a.id = h.suggested_avatar_id
       WHERE h.avatar_id = $1 AND h.status = 'pending' ORDER BY h.created_at DESC`,
      [avatar.id]
    );
    res.json(hints.rows);
  } catch (error: any) {
    console.error('Error fetching hints:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const HintDecisionSchema = z.object({ decision: z.enum(['accept', 'dismiss']) });

/** POST /avatars/:id/hints/:hint_id - accept (starts the conversation) or dismiss a hint. */
router.post('/avatars/:id/hints/:hint_id', async (req: Request, res: Response) => {
  try {
    const avatar = await requireOwnAvatar(req, res);
    if (!avatar) return;
    const payload = HintDecisionSchema.parse(req.body);

    const hintRes = await db.query(
      `SELECT * FROM mojomo.avatar_hints WHERE id = $1 AND avatar_id = $2 AND status = 'pending'`,
      [req.params.hint_id, avatar.id]
    );
    if (hintRes.rows.length === 0) return res.status(404).json({ error: 'Hint not found' });
    const hint = hintRes.rows[0];

    if (payload.decision === 'dismiss') {
      await db.query(`UPDATE mojomo.avatar_hints SET status = 'dismissed' WHERE id = $1`, [hint.id]);
      return res.json({ status: 'dismissed' });
    }

    await db.query(`UPDATE mojomo.avatar_hints SET status = 'accepted' WHERE id = $1`, [hint.id]);
    const conversation = await startMatchedConversation(avatar.id, hint.suggested_avatar_id, hint.reason);
    res.json({ status: 'accepted', conversation_id: conversation.id });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Validation failed', details: error.errors });
    console.error('Error deciding hint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
