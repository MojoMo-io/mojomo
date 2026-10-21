// Express application factory (used by server.ts and by the integration tests).
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import * as db from './services/db';
import { attachSession, requireAuth, enforceOwnership, validateIdParams } from './middleware/auth';
import { httpMetrics, metricsHandler } from './metrics';
import authRoutes from './routes/auth';
import avatarRoutes from './routes/avatars';
import conversationRoutes from './routes/conversations';
import specialistRoutes from './routes/specialists';
import payoutRoutes from './routes/payouts';
import messageRoutes from './routes/messages';
import ideaRoutes from './routes/ideas';
import ideaSurfacingRoutes from './routes/idea-surfacing';
import conversationEndRoutes from './routes/conversation-end';
import reasoningRoutes from './routes/reasoning';
import avatarChatRoutes from './routes/avatar-chat';
import adminRoutes from './routes/admin';
import agentApiRoutes from './routes/agentApi';
import agentClaimPage from './routes/agentClaimPage';
import openapiRoutes from './routes/openapi';
import { linkRouter as telegramLinkRoutes, webhookRouter as telegramWebhookRoutes } from './routes/telegram';
import { ownerRouter as connectionsOwnerRoutes, callbackRouter as connectionsCallbackRoutes } from './routes/connections';

export function allowedOrigins(): string[] {
  const base = (process.env.PUBLIC_URL || 'https://mojomo.io').replace(/\/$/, '');
  const extra = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return [base, base.replace('://', '://www.'), ...extra];
}

export function createApp(): express.Application {
  const app = express();
  app.set('trust proxy', 1);            // nginx terminates TLS
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } })); // pages get CSP from nginx
  app.use(cors({
    origin: (origin, cb) => cb(null, !origin || allowedOrigins().includes(origin)), // same-origin/no-Origin allowed; others get no CORS headers
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type'],
  }));
  app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '100kb' }));
  app.use(httpMetrics);
  app.use((req, res, next) => { console.log(`${new Date().toISOString()} ${req.method} ${req.path}`); next(); });

  app.get('/health', async (req, res) => {
    const ok = await db.healthCheck();
    res.status(ok ? 200 : 503).json({ status: ok ? 'healthy' : 'unhealthy', timestamp: new Date().toISOString() });
  });
  app.get('/metrics', metricsHandler);
  app.use('/api', telegramWebhookRoutes); // Telegram's servers call this directly - no session cookie to check
  app.use('/api', connectionsCallbackRoutes); // OAuth provider redirect - no session cookie of its own; the `state` param proves the avatar

  const apiLimiter = rateLimit({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
    limit: Number(process.env.RATE_LIMIT_MAX || 300),
    standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'Too many requests' },
  });
  app.use('/api', apiLimiter, validateIdParams);
  app.use(openapiRoutes);                             // /openapi.json
  app.use(agentClaimPage);                            // human-facing claim page (HTML)
  app.use('/api', agentApiRoutes);                   // agent-facing: Bearer auth, no session cookie
  app.use('/api', authRoutes);                       // public: magic-link, verify, check, me, logout
  app.use('/api', attachSession, requireAuth, enforceOwnership);
  for (const r of [avatarRoutes, conversationRoutes, specialistRoutes, payoutRoutes, messageRoutes, ideaRoutes, ideaSurfacingRoutes, conversationEndRoutes, reasoningRoutes, avatarChatRoutes, adminRoutes, telegramLinkRoutes, connectionsOwnerRoutes]) app.use('/api', r);

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large' });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON' });
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}
