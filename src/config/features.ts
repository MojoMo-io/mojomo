// Build-scope switches. First build (2026-09-03): conversations + ideas only.
// Token economy (allocation, vesting, payouts, forfeiture math, dilution) and specialists are
// roadmap items kept in code and tests, disabled here. See ROADMAP.md.
import { Request, Response, NextFunction } from 'express';

export const tokensEnabled = (): boolean => process.env.TOKENS_ENABLED === 'true';
export const specialistsEnabled = (): boolean => process.env.SPECIALISTS_ENABLED === 'true';

export const TOKENS_ROADMAP = {
  error: 'Token economy is not enabled in this build',
  roadmap: 'Tokens, vesting and payouts are a roadmap item; this build focuses on conversations and ideas.',
};

/** Internal placeholder allocation used so ledger invariants hold while tokens are hidden. */
export const INTERNAL_PLACEHOLDER_TOKENS = 1000;

const TOKEN_FIELDS = new Set([
  'total_tokens', 'ownership_ledger', 'token_balance', 'ownership_pct', 'vested_pct', 'buy_in_amount',
  'join_round', 'forfeited_tokens', 'forfeiture_data', 'allocated_tokens', 'allocated_pct', 'new_ownership_ledger',
]);

export function stripTokenFields<T>(body: T): T {
  if (Array.isArray(body)) return body.map(stripTokenFields) as any;
  if (body && typeof body === 'object' && !(body instanceof Date)) {
    const out: any = {};
    for (const [k, v] of Object.entries(body as any)) {
      if (TOKEN_FIELDS.has(k)) continue;
      out[k] = stripTokenFields(v);
    }
    return out;
  }
  return body;
}

/** Router middleware: when tokens are disabled, remove token fields from every JSON response. */
export function hideTokenFields(req: Request, res: Response, next: NextFunction): void {
  if (tokensEnabled()) return next();
  const original = res.json.bind(res);
  res.json = ((body: any) => original(stripTokenFields(body))) as any;
  next();
}

/** Router middleware: when tokens are disabled, the whole router is a roadmap item. */
export function requireTokens(req: Request, res: Response, next: NextFunction): void {
  if (tokensEnabled()) return next();
  res.status(403).json(TOKENS_ROADMAP);
}
