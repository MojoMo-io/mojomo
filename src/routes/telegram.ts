// Telegram integration: deep-link auto-onboarding (under /api, session-authenticated) and the
// inbound webhook (top-level, no session - Telegram's servers call this directly).
import { Router, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import * as db from '../services/db';
import * as auth from '../services/auth';
import { getBotUsername, sendTelegramNotification } from '../services/telegram';
import { handleHumanMessage } from '../services/avatarAssistant';

const LINK_TTL_MIN = Number(process.env.TELEGRAM_LINK_TTL_MIN || 30);

export const linkRouter = Router();

/** POST /avatars/:id/telegram/link - returns a one-tap t.me deep link that finishes linking on its own. */
linkRouter.post('/avatars/:id/telegram/link', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!(await auth.ownsAvatar(req.auth!.userId, id))) return res.status(404).json({ error: 'Avatar not found' });

    const username = await getBotUsername();
    if (!username) return res.status(503).json({ error: 'Telegram bot is not configured' });

    const token = randomBytes(24).toString('base64url');
    const expires_at = new Date(Date.now() + LINK_TTL_MIN * 60 * 1000);
    await db.query(
      `INSERT INTO mojomo.telegram_link_tokens (token, avatar_id, expires_at) VALUES ($1, $2, $3)`,
      [token, id, expires_at]
    );

    res.json({ link: `https://t.me/${username}?start=${token}`, expires_at });
  } catch (error: any) {
    console.error('Error creating telegram link:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export const webhookRouter = Router();

/** POST /telegram/webhook - Telegram calls this for every update. Not session-authenticated. */
webhookRouter.post('/telegram/webhook', async (req: Request, res: Response) => {
  // Always 200 quickly - Telegram retries aggressively on non-2xx, and we never want a retry storm.
  res.status(200).end();

  try {
    const message = req.body?.message;
    const chatId: number | undefined = message?.chat?.id;
    const text: string | undefined = message?.text;
    if (!chatId || !text) return;

    const bareStart = /^\/start\s*$/.test(text);
    if (bareStart) {
      await sendTelegramNotification(String(chatId), "Hi! To link this chat to your MOJOMO avatar, go to mojomo.io, open the avatar you want to link, and tap \"Connect Telegram\" - it'll hand you a link that finishes this automatically.");
      return;
    }

    const startMatch = text.match(/^\/start\s+(\S+)/);
    if (startMatch) {
      const token = startMatch[1];
      const tokenRes = await db.query(
        `UPDATE mojomo.telegram_link_tokens SET used_at = NOW()
         WHERE token = $1 AND used_at IS NULL AND expires_at > NOW() RETURNING avatar_id`,
        [token]
      );
      if (tokenRes.rows.length === 0) {
        await sendTelegramNotification(String(chatId), "That link has expired - go back to MOJOMO and generate a fresh one.");
        return;
      }
      const avatarId = tokenRes.rows[0].avatar_id;
      await db.query(
        `UPDATE mojomo.avatars SET telegram_chat_id = $1, telegram_verified_at = NOW(), updated_at = NOW() WHERE id = $2`,
        [chatId, avatarId]
      );
      await sendTelegramNotification(String(chatId), "You're connected. Anything you send here goes straight to your MOJOMO avatar - same chat as the web app.");
      return;
    }

    const avatarRes = await db.query(`SELECT * FROM mojomo.avatars WHERE telegram_chat_id = $1`, [chatId]);
    if (avatarRes.rows.length === 0) {
      await sendTelegramNotification(String(chatId), "This chat isn't linked to a MOJOMO avatar yet. Go to mojomo.io, open your avatar, and tap \"Connect Telegram\" to get a link that finishes this in one tap.");
      return;
    }

    const { reply } = await handleHumanMessage(avatarRes.rows[0], text, 'telegram');
    await sendTelegramNotification(String(chatId), reply.content);
  } catch (error) {
    console.error('Error handling telegram webhook:', error);
  }
});

export default linkRouter;
