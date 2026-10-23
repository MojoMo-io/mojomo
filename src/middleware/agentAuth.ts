// Bearer auth for agent-facing routes. Agents authenticate with mjm_ keys, not
// cookies, so these routes mount before requireAuth.
import { Request, Response } from 'express';
import * as agents from '../services/agents';

export async function requireAgent(req: Request, res: Response, next: Function) {
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
  res.on('finish', () => {
    agents.audit({
      agent_id: resolved.agent.id,
      key_id: resolved.keyId,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      ip: req.ip,
    });
  });
  next();
}

export function requireScope(scope: string) {
  return (req: Request, res: Response, next: Function) => {
    const scopes: string[] = (req as any).agentKey?.scopes || [];
    if (!scopes.includes(scope)) {
      return res.status(403).json({ error: `Missing scope: ${scope}`, granted: scopes });
    }
    next();
  };
}
