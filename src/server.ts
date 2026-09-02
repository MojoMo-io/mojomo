// Main server file
import express from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import * as db from './services/db';
import avatarRoutes from './routes/avatars';
import conversationRoutes from './routes/conversations';
import specialistRoutes from './routes/specialists';
import payoutRoutes from './routes/payouts';
import messageRoutes from './routes/messages';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '8002');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// Health check
app.get('/health', async (req, res) => {
  const isHealthy = await db.healthCheck();
  if (isHealthy) {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  } else {
    res.status(503).json({ status: 'unhealthy', timestamp: new Date().toISOString() });
  }
});

// API routes
app.use('/api', avatarRoutes);
app.use('/api', conversationRoutes);
app.use('/api', specialistRoutes);
app.use('/api', payoutRoutes);
app.use('/api', messageRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown
let isShuttingDown = false;

async function gracefulShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log('\nShutting down gracefully...');
  server.close(async () => {
    await db.closePool();
    console.log('Server shut down');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000); // 10 second timeout
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start server
const server = app.listen(PORT, () => {
  console.log(`MOJOMO API server listening on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Database: ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);
});

export default app;
