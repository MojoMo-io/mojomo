// Process entry point: builds the app and runs background schedulers.
import * as dotenv from 'dotenv';
dotenv.config();
import * as db from './services/db';
import { createApp } from './app';
import { startJobQueue, stopJobQueue } from './services/job-queue';
import { startDormantScheduler, stopDormantScheduler } from './services/forfeiture';
import { startProactiveMatchScheduler, stopProactiveMatchScheduler } from './services/matchmaking';
import { startConnectionSyncScheduler, stopConnectionSyncScheduler } from './services/connections';
import { purgeExpiredAuth } from './services/auth';
import { checkSenderDomain } from './services/mailer';
import { mailProvider } from './services/mailer';

const PORT = parseInt(process.env.PORT || '8002');
const app = createApp();

let authPurge: ReturnType<typeof setInterval> | null = null;
let isShuttingDown = false;
async function gracefulShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('\nShutting down gracefully...');
  await stopJobQueue();
  stopDormantScheduler();
  stopProactiveMatchScheduler();
  stopConnectionSyncScheduler();
  if (authPurge) clearInterval(authPurge);
  server.close(async () => { await db.closePool(); console.log('Server shut down'); process.exit(0); });
  setTimeout(() => { console.error('Forced shutdown after timeout'); process.exit(1); }, 10000);
}
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

const server = app.listen(PORT, async () => {
  console.log(`MOJOMO API server listening on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Database: ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);
  console.log(`Auth: open signup by email magic link; mail provider ${mailProvider()} (${process.env.SMTP_URL || 'smtp://127.0.0.1:25'})`);
  console.log(`Flags: TOKENS_ENABLED=${process.env.TOKENS_ENABLED === 'true'} SPECIALISTS_ENABLED=${process.env.SPECIALISTS_ENABLED === 'true'}`);
  checkSenderDomain();
  await startJobQueue(5000, 5).catch((err) => console.error('Failed to start job queue:', err));
  startDormantScheduler();
  startProactiveMatchScheduler();
  startConnectionSyncScheduler();
  authPurge = setInterval(() => purgeExpiredAuth().catch((e) => console.error('Auth purge failed:', e)), 60 * 60 * 1000);
  // Expire unanswered decision requests and retry missed urgent pings.
  setInterval(() => {
    import('./services/decisionSweeper')
      .then(m => m.sweep())
      .then(r => { if (r.expired || r.pinged) console.log('[decision sweep]', r); })
      .catch(e => console.error('Decision sweep failed:', e?.message || e));
  }, 5 * 60 * 1000);
});

export default app;
