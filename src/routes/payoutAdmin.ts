// Sprint 11.4 — operator surface for MOJO payouts.
//
// Admin-only. Paying an idea is a deliberate act by the operator, not something
// an agent can trigger, so this sits behind requireAdmin rather than the agent
// bearer token.
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as ideaPayouts from '../services/ideaPayouts';
import * as wallet from '../services/wallet';
import * as settlement from '../services/settlement';
import { requireAdmin } from '../middleware/auth';

const router = Router();

// Admin only. Paying an idea is a deliberate operator act, not an agent action.
router.use('/admin', requireAdmin);

const PaySchema = z.object({
  idea_id: z.string().uuid(),
  conversation_id: z.string().uuid().optional(),
  recipient_avatar_id: z.string().uuid().optional(),
  recipient_address: z.string().optional(),
  amount: z.string().regex(/^\d+(\.\d+)?$/),
  reason: z.string().max(500).optional(),
});

/** GET /admin/payouts — float and payout totals. */
router.get('/admin/payouts', async (_req: Request, res: Response) => {
  try {
    res.json({ ok: true, ...(await ideaPayouts.payoutSummary()) });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

/** POST /admin/payouts — pay an idea in MOJO. */
router.post('/admin/payouts', async (req: Request, res: Response) => {
  try {
    const p = PaySchema.parse(req.body);
    const payout = await ideaPayouts.payIdea(p);
    res.status(201).json({ ok: true, payout });
  } catch (e: any) {
    if (e instanceof ideaPayouts.PayoutRefused) {
      return res.status(422).json({ error: e.message, code: e.code });
    }
    if (e instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: e.errors });
    }
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /admin/settlement/run — settle pending payouts.
 *
 * DRY RUN BY DEFAULT. Body { dry_run: false } is required to actually send.
 * Refuses to send while the project is in MVP.
 */
router.post('/admin/settlement/run', async (req: Request, res: Response) => {
  try {
    const dryRun = req.body?.dry_run !== false;
    const limit = Number(req.body?.limit) || 50;
    const report = await settlement.settlePayouts({ dryRun, limit });
    res.json({ ok: true, ...report });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

/** GET /admin/wallet — chain, address, ledger-only state. Never the key. */
router.get('/admin/wallet', async (_req: Request, res: Response) => {
  try {
    const c = wallet.activeChain();
    res.json({
      ok: true,
      chain: c.name,
      chain_id: c.chainId,
      address: wallet.walletAddress(),
      ledger_only: wallet.isLedgerOnly(),
      token_configured: Boolean(c.tokenAddress),
      explorer: c.explorer,
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
