// External data connectors (Google Drive, OneDrive, ...). Owner-scoped routes live under
// /avatars/:id/connections/*; the OAuth redirect callback is public (mounted before the
// session pipeline, like the Telegram webhook) since the provider's redirect carries no
// session context of its own - the one-time `state` param is what proves which avatar this is.
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as auth from '../services/auth';
import * as connections from '../services/connections';
import { listProviders } from '../services/connectors/registry';
import { queueExternalSyncJob, queueProfileSynthesisJob } from '../services/job-queue';

export const ownerRouter = Router();

async function requireOwnAvatarId(req: Request, res: Response): Promise<string | null> {
  const { id } = req.params;
  if (!(await auth.ownsAvatar(req.auth!.userId, id))) {
    res.status(404).json({ error: 'Avatar not found' });
    return null;
  }
  return id;
}

/** GET /avatars/:id/connections - what's connected, plus which providers exist to connect. */
ownerRouter.get('/avatars/:id/connections', async (req: Request, res: Response) => {
  const avatarId = await requireOwnAvatarId(req, res);
  if (!avatarId) return;
  const connected = await connections.listConnections(avatarId);
  res.json({ connected, available_providers: listProviders() });
});

/** GET /avatars/:id/connections/:provider/start - returns the provider's consent URL to redirect to. */
ownerRouter.get('/avatars/:id/connections/:provider/start', async (req: Request, res: Response) => {
  try {
    const avatarId = await requireOwnAvatarId(req, res);
    if (!avatarId) return;
    const url = await connections.startAuthorization(avatarId, req.params.provider);
    res.json({ url });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

const UploadSchema = z.object({
  provider: z.string().min(2).max(40).regex(/^[a-z0-9_-]+$/, 'lowercase letters, numbers, - and _ only'),
  filename: z.string().min(1).max(255),
  content: z.string().min(1).max(3_000_000), // ~3MB of text - a data-export JSON/CSV file, not a binary/zip
});

/**
 * POST /avatars/:id/connections/upload - manual data-export upload (LinkedIn/Facebook/Instagram/
 * anything else with no API access). Client reads the file as text (JSON/CSV export files from
 * these platforms are plain text - if the user has a ZIP from the platform, they extract it
 * first and upload the individual files) and posts it here.
 */
ownerRouter.post('/avatars/:id/connections/upload', async (req: Request, res: Response) => {
  try {
    const avatarId = await requireOwnAvatarId(req, res);
    if (!avatarId) return;
    const payload = UploadSchema.parse(req.body);
    await connections.recordManualUpload(avatarId, payload.provider, payload.filename, payload.content);
    await queueProfileSynthesisJob(avatarId);
    res.status(201).json({ ok: true });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Validation failed', details: error.errors });
    console.error('Error recording manual upload:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** DELETE /avatars/:id/connections/:provider - disconnect; cascades away all synced documents. */
ownerRouter.delete('/avatars/:id/connections/:provider', async (req: Request, res: Response) => {
  const avatarId = await requireOwnAvatarId(req, res);
  if (!avatarId) return;
  await connections.disconnect(avatarId, req.params.provider);
  res.json({ ok: true });
});

export const callbackRouter = Router();

/** GET /connections/:provider/callback - the OAuth redirect target itself. Public, no session. */
callbackRouter.get('/connections/:provider/callback', async (req: Request, res: Response) => {
  const { provider } = req.params;
  const code = String(req.query.code || '');
  const state = String(req.query.state || '');
  if (req.query.error) {
    return res.redirect(302, '/?connection_error=' + encodeURIComponent(String(req.query.error)));
  }
  try {
    const { connectionId } = await connections.handleCallback(provider, code, state);
    await queueExternalSyncJob(connectionId);
    res.redirect(302, '/?connected=' + encodeURIComponent(provider));
  } catch (error: any) {
    console.error('OAuth callback failed:', error.message);
    res.redirect(302, '/?connection_error=' + encodeURIComponent(error.message));
  }
});

export default ownerRouter;
