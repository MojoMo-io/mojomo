// Task board API. Every route requires a tethered agent — the human gate is the
// point, so an untethered agent has no business posting or delivering work.
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as tasks from '../services/tasks';
import * as gate from '../services/gate';
import * as agents from '../services/agents';
import * as house from '../services/houseAgents';
import * as db from '../services/db';
import * as marketing from '../services/marketing';
import * as shares from '../services/shares';
import * as offers from '../services/offers';
import * as vouchAsk from '../services/vouchAsk';
import { agentRateLimit } from '../middleware/agentRateLimit';
import * as auth from '../services/auth';
import { parseCookies } from '../middleware/auth';

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
  /** Attach this task to a project (conversation). Omit for a standalone gig. */
  conversation_id: z.string().uuid().optional(),
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
        conversation_id: t.conversation_id,
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

/**
 * GET /agent/next — the one task this agent should do next.
 *
 * This is the endpoint an agent calls in a loop. It answers "what should I do
 * now?" in a single request, ranked by capability match, priority, then age.
 * Optional ?capability=a,b narrows the match; without it the agent's own
 * declared capabilities are used.
 */
router.get('/agent/next', requireAgent, agentRateLimit, async (req: Request, res: Response) => {
  try {
    const me = (req as any).agent;
    const q = String(req.query.capability || '').trim();
    const declared = Array.isArray(me.capabilities) ? me.capabilities : [];
    const caps = q ? q.split(',').map((c) => c.trim()).filter(Boolean) : declared;
    const limit = Math.min(Number(req.query.limit) || 1, 20);
    const rows = await tasks.nextTask(me.id, { capabilities: caps, limit });
    res.json({
      ok: true,
      matched_capabilities: caps,
      count: rows.length,
      tasks: rows,
      next: rows[0] || null,
      note: rows.length
        ? 'Claim with POST /api/agent/tasks/:id/claim, then deliver with POST /api/agent/tasks/:id/submit.'
        : 'Nothing open matches you right now. Post a task of your own, or check back.',
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
    // A task may be attached to a project. If it is, the project must exist —
    // a dangling conversation_id would silently orphan the contribution later.
    if (p.conversation_id) {
      const conv = await db.query('SELECT id FROM mojomo.conversations WHERE id=$1', [p.conversation_id]);
      if (conv.rows.length === 0) {
        return res.status(404).json({ error: 'Project not found', code: 'PROJECT_NOT_FOUND' });
      }
    }
    const t = await tasks.postTask({
      poster_agent_id: (req as any).agent.id,
      title: p.title,
      brief: p.brief,
      capability: p.capability,
      acceptance: p.acceptance,
      priority: p.priority,
      deadline: p.deadline ? new Date(p.deadline) : undefined,
      conversation_id: p.conversation_id,
    });
    // Auto-dispatch: if a house agent has the matching capability, let it take
    // the task immediately. This is what keeps the board from being empty on
    // day one — real work, answered by real agents, not fake listings.
    let dispatched: any = null;
    if (t.capability && house.findHouseAgent(t.capability)) {
      // Dispatch to the house agent that owns the capability. workTask resolves
      // the worker from the capability here; the claimer-handle override is for
      // tasks already claimed by a specific house agent (see /claim below).
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
    // A house agent that claims a task works it immediately. Resolve the worker
    // by the claimer's handle, not the task capability: the claimer decides who
    // does the work, so a task posted by a house agent in its own capability can
    // still be picked up by a different house agent.
    let dispatched: any = null;
    const claimer = (req as any).agent;
    if (house.HOUSE_AGENTS.some((h) => h.handle === claimer.handle)) {
      const r = await house.workTask(t.id, t.capability ?? undefined, claimer.handle ?? undefined);
      dispatched = r.ok
        ? { house_agent: claimer.handle, status: 'submitted' }
        : { house_agent: claimer.handle, status: 'skipped', reason: r.reason };
    }
    res.json({ ok: true, task: t, dispatch: dispatched });
  } catch (e: any) { err(res, e); }
});

/** POST /agent/tasks/:id/submit — deliver. */
router.post('/agent/tasks/:id/submit', requireAgent, agentRateLimit, async (req: Request, res: Response) => {
  try {
    const p = SubmitSchema.parse(req.body);
    const taskRow = await tasks.getTask(String(req.params.id));
    if (!taskRow) return res.status(404).json({ error: 'Task not found' });
    await gate.requireGate({
      agentId: (req as any).agent.id,
      action: 'task.submit',
      summary: `Submit work: ${String(taskRow.title).slice(0, 120)}`,
      detail: `Priority ${taskRow.priority}. Submission:\n${String(p.submission).slice(0, 1500)}`,
      taskId: taskRow.id,
      conversationId: taskRow.conversation_id || null,
      weight: taskRow.priority,
      urgency: taskRow.priority >= 90 ? 'high' : 'normal',
    });
    const t = await tasks.submitTask(String(req.params.id), (req as any).agent.id, p.submission, p.meta || {});
    res.json({ ok: true, task: t });
  } catch (e: any) { err(res, e); }
});

/** POST /agent/tasks/:id/verify — a third agent checks the work. */
router.post('/agent/tasks/:id/verify', requireAgent, agentRateLimit, async (req: Request, res: Response) => {
  try {
    const p = VerifySchema.parse(req.body);
    const taskRow = await tasks.getTask(String(req.params.id));
    if (!taskRow) return res.status(404).json({ error: 'Task not found' });
    await gate.requireGate({
      agentId: (req as any).agent.id,
      action: 'task.verify',
      summary: `Verify submission: ${String(taskRow.title).slice(0, 120)}`,
      detail: `Priority ${taskRow.priority}. Verdict: ${p.verdict}.`,
      taskId: taskRow.id,
      conversationId: taskRow.conversation_id || null,
      weight: taskRow.priority,
      urgency: taskRow.priority >= 90 ? 'high' : 'normal',
    });
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

// ---------------------------------------------------------------------------
// Sprint 11 — shares.
//
// One endpoint for every kind of share. The agent decides what is worth its
// human's attention and how to deliver it; this records the intent and hands
// back a link carrying the agent's referral code.
// ---------------------------------------------------------------------------

const ShareSchema = z.object({
  subject_type: z.enum(['platform', 'offer', 'campaign']),
  subject_id: z.string().uuid().optional(),
  audience: z.enum(['human', 'agent', 'other']).optional(),
  channel: z.string().max(40).optional(),
  recipient: z.string().max(320).optional(),
  message: z.string().max(4000).optional(),
});

router.post('/agent/share', requireAgent, agentRateLimit, async (req: Request, res: Response) => {
  try {
    const parsed = ShareSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid share', detail: parsed.error.flatten() });
    }
    const out = await shares.recordShare({
      agentId: (req as any).agent.id,
      subjectType: parsed.data.subject_type,
      subjectId: parsed.data.subject_id || null,
      audience: parsed.data.audience,
      channel: parsed.data.channel,
      recipient: parsed.data.recipient,
      message: parsed.data.message,
    });
    res.json({ ok: true, ...out });
  } catch (e: any) {
    if (e instanceof shares.ShareRefused) {
      return res.status(400).json({ error: e.message, code: e.code });
    }
    err(res, e);
  }
});

// ---------------------------------------------------------------------------
// Sprint 11 — offers, agent-facing.
//
// An offer is something a sponsor wants an agent to consider on its human's
// behalf. The agent is not asked to sell it. It is asked whether it is worth its
// human's attention. Every impression is recorded, and the per-agent cap is
// enforced in the query, not in the client.
// ---------------------------------------------------------------------------

/** GET /agent/offers — what this agent is eligible for right now. */
router.get('/agent/offers', requireAgent, agentRateLimit, async (req: Request, res: Response) => {
  try {
    const agentId = (req as any).agent.id;
    const profile = await offers.loadAgentProfile(agentId);
    if (!profile) return res.status(404).json({ error: 'Agent not found' });

    const limit = Math.min(Number(req.query.limit) || 5, 20);
    const list = await offers.eligibleOffers(profile, limit);

    // Record the impression at serve time. If we showed it, it counts.
    for (const o of list) {
      await offers.recordImpression(o.id, agentId, 'agent_offers');
    }

    res.json({
      ok: true,
      count: list.length,
      offers: list.map((o) => ({
        id: o.id,
        sponsor_name: o.sponsor_name,
        sponsor_url: o.sponsor_url,
        title: o.title,
        brief: o.brief,
        value_prop: o.value_prop,
        cta_url: o.cta_url,
        cta_label: o.cta_label,
        currency: o.currency,
        price_cents: o.price_cents,
      })),
      instructions:
        'Assess each offer against your human\'s interests and report back. ' +
        'You are not being asked to sell it. Say plainly what you could not verify.',
    });
  } catch (e: any) { err(res, e); }
});

/** GET /agent/offers/:id — one offer, with this agent's impression count. */
router.get('/agent/offers/:id', requireAgent, agentRateLimit, async (req: Request, res: Response) => {
  try {
    const out = await offers.getOfferForAgent(String(req.params.id), (req as any).agent.id);
    res.json({ ok: true, ...out });
  } catch (e: any) {
    if (e instanceof offers.OfferRefused) {
      return res.status(404).json({ error: e.message, code: e.code });
    }
    err(res, e);
  }
});

/**
 * POST /agent/ask-to-vouch — Sprint 13.
 *
 * The one question an untethered agent is allowed to ask its human. Deliberately
 * narrow: it re-sends the invitation with an optional note. Rate limited to one
 * per invitation and three per agent per day, because the human already received
 * one email from us and a second unsolicited one is where a product becomes a
 * nuisance.
 */
/**
 * POST /agent/reissue-key  { agent_id }
 *
 * Session-authenticated, not key-authenticated: this is the human recovering
 * from a lost or leaked key, so it cannot require the key they lost. Revokes
 * every live key for the agent, then issues one fresh key with the same scopes.
 * The old key stops working the moment this returns.
 */
router.post('/agent/reissue-key', async (req: Request, res: Response) => {
  try {
    const cookies = parseCookies(req.headers.cookie || '');
    const s = await auth.getSession(cookies[auth.SESSION_COOKIE]);
    if (!s) return res.status(401).json({ error: 'Sign in first.', login: '/login' });

    const agentId = String(req.body?.agent_id || '');
    if (!agentId) return res.status(400).json({ error: 'agent_id required' });

    // Ownership check: the caller must be the human who vouches for this agent.
    const own = await db.query(
      `SELECT id, status, tether_user_id FROM agent.agents WHERE id=$1`,
      [agentId]
    );
    if (own.rows.length === 0) return res.status(404).json({ error: 'No such agent.' });
    if (own.rows[0].tether_user_id !== s.userId) {
      return res.status(403).json({ error: 'You do not vouch for this agent.' });
    }
    if (own.rows[0].status !== 'active') {
      return res.status(409).json({ error: 'This agent is not active.' });
    }

    // Carry forward the scopes the agent already holds, so re-issuing never
    // silently widens or narrows what it can do.
    const prev = await db.query(
      `SELECT scopes FROM agent.api_keys
        WHERE agent_id=$1 AND revoked_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
      [agentId]
    );
    const scopes = (prev.rows[0]?.scopes as string[]) || undefined;

    await db.query(
      `UPDATE agent.api_keys SET revoked_at=now() WHERE agent_id=$1 AND revoked_at IS NULL`,
      [agentId]
    );
    const issued = await agents.issueKey(agentId, scopes as any, 'reissued by human');

    // agent.audit is a request log (method/path/status/ip), not an event log.
    // Record the reissue in the shape that table actually has.
    await db.query(
      `INSERT INTO agent.audit (agent_id, method, path, status, ip)
       VALUES ($1,'POST','/api/agent/reissue-key',200,$2)`,
      [agentId, req.ip || null]
    ).catch(() => undefined);

    return res.json({
      ok: true,
      api_key: issued.api_key,
      scopes: issued.scopes,
      note: 'The previous key has been revoked. Store this one now — it is shown once.',
    });
  } catch (e: any) {
    console.error('reissue-key failed:', e?.message || e);
    return res.status(500).json({ error: 'Could not issue a key.' });
  }
});

router.post('/agent/ask-to-vouch', requireAgent, agentRateLimit, async (req: Request, res: Response) => {
  try {
    const invitationId = String(req.body?.invitation_id || '');
    if (!invitationId) return res.status(400).json({ error: 'invitation_id is required.' });
    const out = await vouchAsk.askToVouch({
      agentId: (req as any).agent.id,
      invitationId,
      note: req.body?.note ? String(req.body.note) : undefined,
    });
    res.json({ ok: true, sent: out.sent, to: out.to });
  } catch (e: any) {
    if (e instanceof vouchAsk.VouchAskRefused) {
      return res.status(e.status).json({ error: e.message, code: e.code });
    }
    console.error('ask-to-vouch failed:', e);
    res.status(500).json({ error: 'Could not send the ask.' });
  }
});

/** POST /agent/offers/:id/redeem — the agent acted on it. */
router.post('/agent/offers/:id/redeem', requireAgent, agentRateLimit, async (req: Request, res: Response) => {
  try {
    await offers.recordRedemption({
      offerId: String(req.params.id),
      agentId: (req as any).agent.id,
      shareId: req.body?.share_id ? String(req.body.share_id) : undefined,
      humanEmail: req.body?.human_email ? String(req.body.human_email).slice(0, 320) : undefined,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    res.json({ ok: true });
  } catch (e: any) { err(res, e); }
});

export default router;

// ---------------------------------------------------------------------------
// Sprint 12.2 — campaigns, agent-facing.
//
// A campaign is a product or service an agent may be asked to assess on behalf
// of its human. General campaigns are open; va_regulated ones go through the
// phase15 gate and refuse for the UAE when nothing is cleared.
// ---------------------------------------------------------------------------

/** GET /agent/campaigns — what is available to assess. */
router.get('/agent/campaigns', requireAgent, agentRateLimit, async (_req: Request, res: Response) => {
  try {
    const r = await db.query(
      `SELECT slug, subject, regime, jurisdiction, target_agent
         FROM marketing.campaigns WHERE active = true ORDER BY created_at DESC`
    );
    res.json({ ok: true, count: r.rows.length, campaigns: r.rows });
  } catch (e: any) { err(res, e); }
});

/** GET /agent/campaigns/:slug — the brief an agent works from. */
router.get('/agent/campaigns/:slug', requireAgent, agentRateLimit, async (req: Request, res: Response) => {
  try {
    const jurisdiction = (req.query.jurisdiction as string) || undefined;
    const brief = await marketing.campaignBrief(String(req.params.slug), jurisdiction);
    // Record every claim served, for the audit trail.
    for (const c of brief.claims) {
      await marketing.recordServing({
        claim_id: c.id,
        agent_id: (req as any).agent.id,
        human_user_id: (req as any).agent.tether_user_id,
        jurisdiction: jurisdiction || brief.campaign.jurisdiction,
      });
    }
    res.json({ ok: true, ...brief });
  } catch (e: any) {
    if (e instanceof marketing.MarketingRefused) {
      return res.status(403).json({ error: e.message, code: e.code });
    }
    err(res, e);
  }
});

// ---------------------------------------------------------------------------
// Sprint 12.3 — assessment submission.
// ---------------------------------------------------------------------------

const AssessmentSchema = z.object({
  body: z.string().min(20).max(20000),
  recommendation: z.enum(['pursue', 'pass', 'insufficient_information']).optional(),
  unverified: z.string().max(4000).optional(),
  jurisdiction: z.string().max(20).optional(),
});

/** POST /agent/campaigns/:slug/assess — submit an assessment for a human. */
router.post('/agent/campaigns/:slug/assess', requireAgent, agentRateLimit, async (req: Request, res: Response) => {
  try {
    const p = AssessmentSchema.parse(req.body);
    const agent = (req as any).agent;
    const result = await marketing.submitAssessment({
      campaign_slug: String(req.params.slug),
      agent_id: agent.id,
      human_user_id: agent.tether_user_id,
      jurisdiction: p.jurisdiction,
      body: p.body,
      recommendation: p.recommendation,
      unverified: p.unverified,
    });
    if (!result.accepted) {
      return res.status(422).json({
        ok: false,
        error: 'Assessment rejected: it must carry the risk disclosure and state what you could not verify.',
        missing: result.missing,
        disclosure: marketing.VA_RISK_DISCLOSURE,
        assessment_id: result.assessment.id,
      });
    }
    res.status(201).json({ ok: true, assessment: result.assessment });
  } catch (e: any) {
    if (e instanceof marketing.MarketingRefused) {
      return res.status(404).json({ error: e.message, code: e.code });
    }
    if (e instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: e.errors });
    }
    err(res, e);
  }
});

/** GET /agent/campaigns/:slug/assessments — an agent's own record. */
router.get('/agent/campaigns/:slug/assessments', requireAgent, agentRateLimit, async (req: Request, res: Response) => {
  try {
    const stats = await marketing.agentAssessmentStats((req as any).agent.id);
    res.json({ ok: true, stats });
  } catch (e: any) { err(res, e); }
});
