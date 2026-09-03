import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as db from '../services/db';
import * as claudeService from '../services/claude';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

const TriggerReasoningSchema = z.object({
  prompt_override: z.string().optional(),
});

router.post('/conversations/:id/reasoning', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const payload = TriggerReasoningSchema.parse(req.body);

    const conversation = await db.query(
      'SELECT * FROM mojomo.conversations WHERE id = $1',
      [id]
    );

    if (conversation.rows.length === 0) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const messages = await db.query(
      'SELECT avatar_id, message_content, created_at FROM mojomo.conversation_messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [id]
    );

    const reasoning_id = uuidv4();

    await db.query(
      `INSERT INTO mojomo.reasoning_logs (id, conversation_id, prompt, status)
       VALUES ($1, $2, $3, $4)`,
      [reasoning_id, id, payload.prompt_override || '', 'pending']
    );

    await db.query(
      `INSERT INTO mojomo.message_queue (conversation_id, reasoning_logs_id, status)
       VALUES ($1, $2, $3)`,
      [id, reasoning_id, 'pending']
    );

    const tokenEstimate = claudeService.estimateTokens(
      claudeService.buildUserPrompt(
        messages.rows.map((r: any) => ({
          avatar_id: r.avatar_id,
          content: r.message_content,
          created_at: new Date(r.created_at),
        })),
        payload.prompt_override
      )
    );

    res.status(201).json({
      reasoning_id,
      status: 'pending',
      message_count: messages.rows.length,
      token_estimate: tokenEstimate,
    });

    // Trigger background job (non-blocking)
    // Processing is owned exclusively by the job queue (services/job-queue.ts) so a
    // job can never be executed twice.
  } catch (error: any) {
    console.error('Error triggering reasoning:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/reasoning-logs/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      'SELECT * FROM mojomo.reasoning_logs WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Reasoning not found' });
    }

    const log = result.rows[0];
    res.json({
      id: log.id,
      conversation_id: log.conversation_id,
      status: log.status,
      response: log.response ? JSON.parse(log.response) : null,
      tokens_used: log.tokens_used,
      cost: log.cost,
      error_message: log.error_message,
      created_at: log.created_at,
      completed_at: log.completed_at,
    });
  } catch (error: any) {
    console.error('Error fetching reasoning:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


export default router;
