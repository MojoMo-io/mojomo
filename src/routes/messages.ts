// Message API endpoints with Telegram notifications
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as messageService from '../services/messages';
import * as conversationService from '../services/conversations';
import { sendTelegramNotification } from '../services/telegram';
import * as db from '../services/db';

const router = Router();

const StoreMessageSchema = z.object({
  avatar_id: z.string().uuid(),
  message_content: z.string().min(1).max(10000),
  message_type: z.enum(['user_message', 'ai_response']),
  reasoning_trace: z.record(z.any()).optional(),
  idea_score: z.number().min(0).max(100).optional(),
});

/**
 * POST /conversations/:id/messages - Add message to conversation
 */
router.post('/conversations/:id/messages', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const payload = StoreMessageSchema.parse(req.body);

    // Store message
    const message = await messageService.storeMessage(
      id,
      payload.avatar_id,
      payload.message_content,
      payload.message_type,
      payload.reasoning_trace,
      payload.idea_score
    );

    // Notify other participants (async, don't wait)
    notifyParticipantsAsync(id, payload.avatar_id, message);

    res.status(201).json(message);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }

    if (error.message.includes('not a participant')) {
      return res.status(403).json({ error: 'Avatar is not a participant in this conversation' });
    }

    if (error.message.includes('not found')) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    console.error('Error storing message:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /conversations/:id/messages - List conversation messages
 */
router.get('/conversations/:id/messages', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const messages = await messageService.listConversationMessages(id, limit, offset);

    res.json({
      conversation_id: id,
      total_count: messages.length,
      limit,
      offset,
      messages,
    });
  } catch (error: any) {
    console.error('Error listing messages:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /conversations/:id/messages/:message_id - Get single message
 */
router.get('/conversations/:id/messages/:message_id', async (req: Request, res: Response) => {
  try {
    const { id, message_id } = req.params;

    const message = await messageService.getMessage(message_id);

    // Verify message belongs to conversation
    if (message.conversation_id !== id) {
      return res.status(404).json({ error: 'Message not found in this conversation' });
    }

    res.json(message);
  } catch (error: any) {
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: 'Message not found' });
    }
    console.error('Error fetching message:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /conversations/:id/messages/ideas - List high-scoring idea messages
 */
router.get('/conversations/:id/ideas-messages', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const min_score = parseInt(req.query.min_score as string) || 65;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

    const messages = await messageService.getIdeaMessages(id, min_score, limit);

    res.json({
      conversation_id: id,
      min_idea_score: min_score,
      count: messages.length,
      messages,
    });
  } catch (error: any) {
    console.error('Error fetching idea messages:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Notify all participants about a new message
 * Runs async, doesn't block response
 */
async function notifyParticipantsAsync(
  conversation_id: string,
  sender_avatar_id: string,
  message: any
): Promise<void> {
  // Run in background
  setImmediate(async () => {
    try {
      const conversation = await conversationService.getConversation(conversation_id);

      // Get all participant avatar IDs
      const participant_ids = [
        conversation.initiator_avatar_id,
        conversation.target_avatar_id,
        ...conversation.participant_avatar_ids,
      ];

      // Filter: only notify others, not the sender
      const recipients = participant_ids.filter((id) => id !== sender_avatar_id);

      // Get avatar details for each recipient
      for (const recipient_id of recipients) {
        try {
          const avatarResult = await db.query(
            'SELECT * FROM mojomo.avatars WHERE id = $1',
            [recipient_id]
          );

          if (avatarResult.rows.length === 0) {
            continue; // Avatar not found
          }

          const avatar = avatarResult.rows[0];

          // Skip if no verified Telegram chat
          if (!avatar.telegram_chat_id || !avatar.telegram_verified_at) {
            continue;
          }

          // Send notification
          const notif_text = `New message in "${conversation.title}": ${message.message_content.slice(0, 100)}${message.message_content.length > 100 ? '...' : ''}`;

          await sendTelegramNotification(avatar.telegram_chat_id, notif_text);

          // Log notification event
          await db.query(
            `INSERT INTO mojomo.conversation_events (
              conversation_id, event_type, event_data
            ) VALUES ($1, $2, $3)`,
            [
              conversation_id,
              'telegram_notification_sent',
              JSON.stringify({
                recipient_avatar_id: recipient_id,
                message_id: message.id,
                telegram_chat_id: avatar.telegram_chat_id,
              }),
            ]
          );
        } catch (notif_error) {
          // Log notification failure but don't fail the overall request
          console.error(`Notification failed for avatar ${recipient_id}:`, notif_error);
        }
      }
    } catch (error) {
      console.error('Error notifying participants:', error);
    }
  });
}

export default router;
