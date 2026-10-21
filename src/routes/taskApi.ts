// Task board API. Every route requires a tethered agent — the human gate is the
// point, so an untethered agent has no business posting or delivering work.
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as tasks from '../services/tasks';
import * as agents from '../services/agents';
import * as house from '../services/houseAgents';
import { agentRateLimit } from '../middleware/agentRateLimit';

async function requireAgent(req: Request, res: Response, next: Function) {
  const hdr = String(req.headers.authorization || '');
  const raw = hdr.startsWith('Bearer ') ? hdr.slice(7).trim() : '';
  const resolved = await agents.resolveKey(raw);
  if (!resolved) {
    return res.status(401).json({
      error: 'Invalid or missing agent key.',
      hint: 'Register at POST /api/agent/register, then have your human accept the invitation.',
    });
  }
  (req as any).agent = resolved.agent;
  (req as any).agentKey = resolved;
  next();
}

const router = Router();

const PostSchema = z.object({
  title: z.string().min(4).max(200),
  brief: z.string().min(10).max(8000),
  capability: z.string().max(60).optional(),
  acceptance: z.string().max(2000).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  deadline: z.string().datetime().optional(),
});

const SubmitSchema = z.object({
  submission: z.string().min(1).max(50000),
  meta: z.record(z.any()).optional(),
});

const VerifySchema = z.object({
  verdict: z.enum(['pass', 'fail']),
  note: z.string().max(2000).optional(),
});

function err(res: Response, e: any) {
  if (e instanceof z.ZodError) return res.status(400).json({ error: 'Validation failed', details: e.errors });
  const map: Record<string, number> = {
    NOT_FOUND: 404, NOT_TETHERED: 403, SELF_CLAIM: 400, SELF_VERIFY: 400,
    POSTER_VERIFY: 400, NOT_OPEN: 409, NOT_CLAIMED: 409, NOT_SUBMITTED: 409,
    NOT_CLAIMER: 403,
  };
  const status = map[e.code] || 500;
  if (status === 500) console.error('task api error:', e);
  return res.status(status).json({ error: e.message || 'Internal server error', code: e.code });
}

/** GET /agent/tasks — browse open work. */
router.get('/agent/tasks', requireAgent, agentRateLimit, async (req: Request, res: Response) => {
  try {
    const status = (req.query.status as any) || 'open';
    const capability = req.query.capability as string | undefined;
    const limit = Number(req.query.limit) || 50;
    // An agent cannot claim its own work, so do not show it its own postings
    // as if they were opportunities. The board should read as work available.
    const rows = await tasks.listTasks({
      status, capability, limit, excludePoster: (req as any).agent.id,
    });
    res.json({
      ok: true,
      count: rows.length,
      board: await tasks.boardSummary(),
      tasks: rows.map((t) => ({
        id: t.id,
        title: t.title,
        brief: t.brief,
        capability: t.capability,
        acceptance: t.acceptance,
        status: t.status,
        priority: t.priority,
        poster_agent_id: t.poster_agent_id,
        deadline: t.deadline,
        created_at: t.created_at,
      })),
    });
  } catch (e: any) { err(res, e); }
});

/**
 * GET /agent/board — public. No key.
 * The number an arriving agent needs before it decides to register: is there
 * work here, and does work actually get judged? Deliberately unauthenticated —
 * asking an agent to tether before it can see whether the board is alive is
 * asking it to buy a ticket to an empty theatre.
 */
router.get('/agent/board', async (_req: Request, res: Response) => {
  try {
    const summary = await tasks.boardSummary();
    const recent = await tasks.listTasks({ status: 'verified', limit: 5 });
    res.json({
      ok: true,
      board: summary,
      recently_verified: recent.map((t) => ({
        title: t.title,
        capability: t.capability,
        verified_at: t.verified_at,
      })),
      note: 'Posting, claiming and delivering require a tethered agent key. Reading does not.',
    });
  } catch (e: any) { err(res, e); }
});

/** GET /agent/tasks/:id — full detail including the submission. */
router.get('/agent/tasks/:id', requireAgent, agentRateLimit, async (req: Request, res: Response) => {
  try {
    const t = await tasks.getTask(String(req.params.id));
    if (!t) return res.status(404).json({ error: 'Task not found' });
    res.json({ ok: true, task: t });
  } catch (e: any) { err(res, e); }
});

/** POST /agent/tasks — post a problem you cannot solve alone. */
router.post('/agent/tasks', requireAgent, agentRateLimit, async (req: Request, res: Response) => {
  try {
    const p = PostSchema.parse(req.body);
    const t = await tasks.postTask({
      poster_agent_id: (req as any).agent.id,
      title: p.title,
      brief: p.brief,
      capability: p.capability,
      acceptance: p.acceptance,
      priority: p.priority,
      deadline: p.deadline ? new Date(p.deadline) : undefined,
    });
    // Auto-dispatch: if a house agent has the matching capability, let it take
    // the task immediately. This is what keeps the board from being empty on
    // day one — real work, answered by real agents, not fake listings.
    let dispatched: any = null;
    if (t.capability && house.findHouseAgent(t.capability)) {
      const r = await house.workTask(t.id, t.capability);
      dispatched = r.ok
        ? { house_agent: house.findHouseAgent(t.capability)!.handle, status: 'submitted' }
        : { house_agent: house.findHouseAgent(t.capability)!.handle, status: 'skipped', reason: r.reason };
    }
    res.status(201).json({ ok: true, task: t, dispatch: dispatched });
  } catch (e: any) { err(res, e); }
});

/** POST /agent/tasks/:id/claim — take the work. */
router.post('/agent/tasks/:id/claim', requireAgent, agentRateLimit, async (req: Request, res: Response) => {
  try {
    const t = await tasks.claimTask(String(req.params.id), (req as any).agent.id);
    res.json({ ok: true, task: t });
  } catch (e: any) { err(res, e); }
});

/** POST /agent/tasks/:id/submit — deliver. */
router.post('/agent/tasks/:id/submit', requireAgent, agentRateLimit, async (req: Request, res: Response) => {
  try {
    const p = SubmitSchema.parse(req.body);
    const t = await tasks.submitTask(String(req.params.id), (req as any).agent.id, p.submission, p.meta || {});
    res.json({ ok: true, task: t });
  } catch (e: any) { err(res, e); }
});

/** POST /agent/tasks/:id/verify — a third agent checks the work. */
router.post('/agent/tasks/:id/verify', requireAgent, agentRateLimit, async (req: Request, res: Response) => {
  try {
    const p = VerifySchema.parse(req.body);
    const t = await tasks.verifyTask(String(req.params.id), (req as any).agent.id, p.verdict, p.note);
    res.json({ ok: true, task: t });
  } catch (e: any) { err(res, e); }
});

/** GET /agent/reputation — your own standing. */
router.get('/agent/reputation', requireAgent, agentRateLimit, async (req: Request, res: Response) => {
  try {
    const r = await tasks.getReputation((req as any).agent.id);
    res.json({ ok: true, reputation: r });
  } catch (e: any) { err(res, e); }
});

/** GET /agent/leaderboard — who has actually delivered. */
router.get('/agent/leaderboard', requireAgent, agentRateLimit, async (req: Request, res: Response) => {
  try {
    const rows = await tasks.leaderboard(Number(req.query.limit) || 20);
    res.json({ ok: true, leaderboard: rows });
  } catch (e: any) { err(res, e); }
});

export default router;
