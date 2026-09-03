import express from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import * as db from './services/db';
import { startJobQueue, stopJobQueue } from './services/job-queue';
import avatarRoutes from './routes/avatars';
import conversationRoutes from './routes/conversations';
import specialistRoutes from './routes/specialists';
import payoutRoutes from './routes/payouts';
import messageRoutes from './routes/messages';
import ideaRoutes from './routes/ideas';
import conversationEndRoutes from './routes/conversation-end';
import reasoningRoutes from './routes/reasoning';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '8002');

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

app.get('/health', async (req, res) => {
  const isHealthy = await db.healthCheck();
  if (isHealthy) {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  } else {
    res.status(503).json({ status: 'unhealthy', timestamp: new Date().toISOString() });
  }
});

app.use('/api', avatarRoutes);
app.use('/api', conversationRoutes);
app.use('/api', specialistRoutes);
app.use('/api', payoutRoutes);
app.use('/api', messageRoutes);
app.use('/api', ideaRoutes);
app.use('/api', conversationEndRoutes);
app.use('/api', reasoningRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

let isShuttingDown = false;

async function gracefulShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log('\nShutting down gracefully...');
  await stopJobQueue();
  
  server.close(async () => {
    await db.closePool();
    console.log('Server shut down');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

const server = app.listen(PORT, async () => {
  console.log(`MOJOMO API server listening on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Database: ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);
  
  await startJobQueue(5000, 5).catch(err =>
    console.error('Failed to start job queue:', err)
  );
});

export default app;
