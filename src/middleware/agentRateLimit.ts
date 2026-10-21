// Rate limiting for agent API keys. Keyed on the key itself, not the IP —
// agents behind shared infrastructure would otherwise throttle each other.
import { Request, Response, NextFunction } from 'express';

const buckets = new Map<string, { count: number; resetAt: number }>();

export function agentRateLimit(req: Request, res: Response, next: NextFunction) {
  const key = (req as any).agentKey;
  if (!key) return next();

  const limit = key.rateLimit || 60;
  const now = Date.now();
  const id = key.keyId;
  let b = buckets.get(id);

  if (!b || now > b.resetAt) {
    b = { count: 0, resetAt: now + 60_000 };
    buckets.set(id, b);
  }
  b.count++;

  res.setHeader('X-RateLimit-Limit', String(limit));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - b.count)));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(b.resetAt / 1000)));

  if (b.count > limit) {
    res.setHeader('Retry-After', String(Math.ceil((b.resetAt - now) / 1000)));
    return res.status(429).json({
      error: 'Rate limit exceeded',
      limit,
      retry_after_seconds: Math.ceil((b.resetAt - now) / 1000),
    });
  }
  next();
}

// Periodic sweep so the map doesn't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k);
}, 300_000).unref();
