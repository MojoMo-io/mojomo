// Sprint 10 — user wallet address management.
//
// Mounted after attachSession + requireAuth, so req.auth is always present here.
// A user can only ever see and change their own addresses; user_id comes from the
// session, never from the request body.
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as userWallets from '../services/userWallets';

const router = Router();

const AddSchema = z.object({
  chain: z.enum(['polygon', 'ethereum']),
  address: z.string().min(1),
  label: z.string().max(100).optional(),
  make_default: z.boolean().optional(),
});

/** GET /wallets — the caller's addresses. */
router.get('/wallets', async (req: Request, res: Response) => {
  try {
    const chain = typeof req.query.chain === 'string' ? req.query.chain : undefined;
    res.json({ ok: true, wallets: await userWallets.listWallets(req.auth!.userId, chain) });
  } catch (e: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** POST /wallets — add an address. First address for a chain becomes the default. */
router.post('/wallets', async (req: Request, res: Response) => {
  try {
    const p = AddSchema.parse(req.body);
    const wallet = await userWallets.addWallet({ user_id: req.auth!.userId, ...p });
    res.status(201).json({ ok: true, wallet });
  } catch (e: any) {
    if (e instanceof userWallets.WalletError) {
      return res.status(422).json({ error: e.message, code: e.code });
    }
    if (e instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: e.errors });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** POST /wallets/:id/default — make this address the payout address for its chain. */
router.post('/wallets/:id/default', async (req: Request, res: Response) => {
  try {
    const wallet = await userWallets.setDefaultWallet(req.auth!.userId, req.params.id);
    res.json({ ok: true, wallet });
  } catch (e: any) {
    if (e instanceof userWallets.WalletError) {
      return res.status(404).json({ error: e.message, code: e.code });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** DELETE /wallets/:id — remove an address. Promotes another if it was the default. */
router.delete('/wallets/:id', async (req: Request, res: Response) => {
  try {
    await userWallets.deleteWallet(req.auth!.userId, req.params.id);
    res.json({ ok: true });
  } catch (e: any) {
    if (e instanceof userWallets.WalletError) {
      return res.status(404).json({ error: e.message, code: e.code });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
