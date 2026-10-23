// Prometheus metrics (Phase 5). Exposed at /metrics for loopback clients only.
import client from 'prom-client';
import { Request, Response, NextFunction } from 'express';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: 'mojomo_' });

export const metrics = {
  httpDuration: new client.Histogram({ name: 'mojomo_http_request_duration_seconds', help: 'HTTP request duration', labelNames: ['method', 'route', 'status'] as const, buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.5, 1, 2, 5], registers: [registry] }),
  reasoningJobs: new client.Counter({ name: 'mojomo_reasoning_jobs_total', help: 'Reasoning jobs by outcome', labelNames: ['status'] as const, registers: [registry] }),
  reasoningCost: new client.Counter({ name: 'mojomo_reasoning_cost_usd_total', help: 'Estimated LLM spend', registers: [registry] }),
  ideasExtracted: new client.Counter({ name: 'mojomo_ideas_extracted_total', help: 'Ideas extracted from reflections', registers: [registry] }),
  ideasSurfaced: new client.Counter({ name: 'mojomo_ideas_surfaced_total', help: 'Ideas reaching mature', registers: [registry] }),
  magicLinks: new client.Counter({ name: 'mojomo_magic_links_total', help: 'Magic links issued', labelNames: ['provider', 'accepted'] as const, registers: [registry] }),
  loginAttempts: new client.Counter({ name: 'mojomo_login_attempts_total', help: 'Login attempts by result', labelNames: ['result'] as const, registers: [registry] }),
};

/** Normalise dynamic path segments so label cardinality stays bounded. */
export function routeLabel(path: string): string {
  return path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id').replace(/\?.*$/, '').slice(0, 80);
}

export function httpMetrics(req: Request, res: Response, next: NextFunction): void {
  const end = metrics.httpDuration.startTimer();
  res.on('finish', () => end({ method: req.method, route: routeLabel(req.path), status: String(res.statusCode) }));
  next();
}

const isLoopback = (ip: string | undefined) => !!ip && /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(ip);

export async function metricsHandler(req: Request, res: Response): Promise<void> {
  // req.ip honours trust proxy; nginx never proxies /metrics, so only local scrapers reach this.
  if (!isLoopback(req.socket.remoteAddress) || req.headers['x-forwarded-for']) { res.status(404).json({ error: 'Not found' }); return; }
  res.setHeader('Content-Type', registry.contentType);
  res.end(await registry.metrics());
}
