// Idea repository API endpoints
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as ideaService from '../services/ideas';

const router = Router();

const RefineIdeaSchema = z.object({
  avatar_id: z.string().uuid(),
  full_hypothesis: z.string().min(1).max(10000).optional(),
  note: z.string().max(2000).optional(),
  confidence_score: z.number().min(0).max(1).optional(),
});

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

    if (error.message.includes('backwards') || error.message.includes('already')) {
      return res.status(400).json({ error: error.message });
    }
    if (error.message.includes('requires') || error.message.includes('skip')) {
      return res.status(409).json({ error: error.message });
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

/**
 * POST /conversations/:id/ideas/:idea_id/refinements - refine an idea (counts toward maturity gates)
 */
router.post('/conversations/:id/ideas/:idea_id/refinements', async (req: Request, res: Response) => {
  try {
    const { id, idea_id } = req.params;
    const payload = RefineIdeaSchema.parse(req.body);
    const existing = await ideaService.getIdea(idea_id);
    if (existing.conversation_id !== id) {
      return res.status(404).json({ error: 'Idea not found in this conversation' });
    }
    const result = await ideaService.refineIdea(idea_id, payload.avatar_id, payload);
    res.status(201).json(result);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    if (error.message.includes('not a participant')) {
      return res.status(403).json({ error: error.message });
    }
    if (error.message.includes('already mature')) {
      return res.status(409).json({ error: error.message });
    }
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: 'Idea not found' });
    }
    console.error('Error refining idea:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /conversations/:id/ideas/:idea_id/refinements - refinement history
 */
router.get('/conversations/:id/ideas/:idea_id/refinements', async (req: Request, res: Response) => {
  try {
    const { id, idea_id } = req.params;
    const existing = await ideaService.getIdea(idea_id);
    if (existing.conversation_id !== id) {
      return res.status(404).json({ error: 'Idea not found in this conversation' });
    }
    res.json({ idea_id, refinements: await ideaService.listRefinements(idea_id), gates: ideaService.MATURITY_GATES });
  } catch (error: any) {
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: 'Idea not found' });
    }
    console.error('Error listing refinements:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
