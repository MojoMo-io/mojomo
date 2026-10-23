// Agent-facing decision-request endpoints. Bearer auth, tethered agents only.
import { Router, Request, Response } from 'express';
import * as decisions from '../services/decisionRequests';
import { requireAgent } from '../middleware/agentAuth';

const router = Router();

/**
 * POST /agent/ask  { kind, title, body?, options?, urgency?, ttl_hours?, task_id?, conversation_id? }
 * Ask your human a question. Returns the request, including its id.
 */
router.post('/agent/ask', requireAgent, async (req: Request, res: Response) => {
  try {
    const agentId = (req as any).agent.id;
    const r = await decisions.create({
      agentId,
      kind: req.body?.kind,
      title: req.body?.title,
      body: req.body?.body,
      options: req.body?.options,
      urgency: req.body?.urgency,
      ttlHours: req.body?.ttl_hours,
      taskId: req.body?.task_id || null,
      conversationId: req.body?.conversation_id || null,
      source: req.body?.task_id ? 'task' : (req.body?.conversation_id ? 'conversation' : 'agent'),
    });
    res.status(201).json({ ok: true, request: r });
  } catch (e: any) {
    if (e instanceof decisions.DecisionError) {
      return res.status(e.status).json({ error: e.message, code: e.code });
    }
    console.error('ask failed:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /agent/ask/:id
 * Poll one request. This is how an agent learns its human answered.
 */
router.get('/agent/ask/:id', requireAgent, async (req: Request, res: Response) => {
  try {
    const agentId = (req as any).agent.id;
    const r = await decisions.getById(String(req.params.id));
    if (!r || r.agent_id !== agentId) return res.status(404).json({ error: 'Request not found.' });
    res.json({ ok: true, request: r });
  } catch (e: any) {
    console.error('ask get failed:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /agent/ask?status=pending
 * List this agent's requests.
 */
router.get('/agent/ask', requireAgent, async (req: Request, res: Response) => {
  try {
    const agentId = (req as any).agent.id;
    const status = req.query.status ? String(req.query.status) : undefined;
    const rows = await decisions.listForAgent(agentId, { status: status as any });
    res.json({ ok: true, requests: rows });
  } catch (e: any) {
    console.error('ask list failed:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /agent/ask/:id/withdraw
 * Take back a question that no longer matters.
 */
router.post('/agent/ask/:id/withdraw', requireAgent, async (req: Request, res: Response) => {
  try {
    const agentId = (req as any).agent.id;
    const r = await decisions.withdraw(String(req.params.id), agentId);
    res.json({ ok: true, request: r });
  } catch (e: any) {
    if (e instanceof decisions.DecisionError) {
      return res.status(e.status).json({ error: e.message, code: e.code });
    }
    console.error('ask withdraw failed:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
