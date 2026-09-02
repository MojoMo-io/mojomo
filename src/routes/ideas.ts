// Idea repository API endpoints
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as ideaService from '../services/ideas';

const router = Router();

const UpdateIdeaSchema = z.object({
  maturity_stage: z.enum(['seedling', 'exploring', 'refined', 'mature']),
});

/**
 * GET /conversations/:id/ideas - List ideas from conversation
 */
router.get('/conversations/:id/ideas', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const ideas = await ideaService.listIdeas(id, limit, offset);

    res.json({
      conversation_id: id,
      total_count: ideas.length,
      limit,
      offset,
      ideas,
    });
  } catch (error: any) {
    console.error('Error listing ideas:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /conversations/:id/ideas/:idea_id - Get full idea with message
 */
router.get('/conversations/:id/ideas/:idea_id', async (req: Request, res: Response) => {
  try {
    const { id, idea_id } = req.params;

    const idea = await ideaService.getIdeaWithMessage(idea_id);

    // Verify idea belongs to conversation
    if (idea.conversation_id !== id) {
      return res.status(404).json({ error: 'Idea not found in this conversation' });
    }

    res.json(idea);
  } catch (error: any) {
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: 'Idea not found' });
    }
    console.error('Error fetching idea:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /conversations/:id/ideas/:idea_id - Update idea maturity
 */
router.patch('/conversations/:id/ideas/:idea_id', async (req: Request, res: Response) => {
  try {
    const { id, idea_id } = req.params;
    const payload = UpdateIdeaSchema.parse(req.body);

    const idea = await ideaService.updateIdeaMaturity(idea_id, payload.maturity_stage);

    // Verify idea belongs to conversation
    if (idea.conversation_id !== id) {
      return res.status(404).json({ error: 'Idea not found in this conversation' });
    }

    res.json(idea);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }

    if (error.message.includes('backwards')) {
      return res.status(400).json({ error: error.message });
    }

    if (error.message.includes('not found')) {
      return res.status(404).json({ error: 'Idea not found' });
    }

    console.error('Error updating idea:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /conversations/:id/ideas/maturity/:stage - List ideas by maturity stage
 */
router.get('/conversations/:id/ideas-by-maturity/:stage', async (req: Request, res: Response) => {
  try {
    const { id, stage } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

    if (!['seedling', 'exploring', 'refined', 'mature'].includes(stage)) {
      return res.status(400).json({ error: 'Invalid maturity stage' });
    }

    const ideas = await ideaService.listIdeasByMaturity(
      id,
      stage as 'seedling' | 'exploring' | 'refined' | 'mature',
      limit
    );

    res.json({
      conversation_id: id,
      maturity_stage: stage,
      total_count: ideas.length,
      ideas,
    });
  } catch (error: any) {
    console.error('Error listing ideas by maturity:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
