import * as db from './db';
import * as claudeService from './claude';

interface QueueJob {
  id: string;
  conversation_id: string;
  reasoning_logs_id: string;
  status: string;
  attempts: number;
}

let isRunning = false;
let processInterval: ReturnType<typeof setInterval> | null = null;

export async function startJobQueue(
  intervalMs: number = 5000,
  maxConcurrent: number = 5
): Promise<void> {
  if (isRunning) {
    console.log('Job queue already running');
    return;
  }

  isRunning = true;
  console.log(`Starting job queue (interval: ${intervalMs}ms, concurrency: ${maxConcurrent})`);

  processInterval = setInterval(async () => {
    try {
      await processNextBatch(maxConcurrent);
    } catch (error) {
      console.error('Error in job queue interval:', error);
    }
  }, intervalMs);
}

export async function stopJobQueue(): Promise<void> {
  if (processInterval) {
    clearInterval(processInterval);
    processInterval = null;
  }
  isRunning = false;
  console.log('Job queue stopped');
}

async function processNextBatch(maxConcurrent: number): Promise<void> {
  try {
    const jobs = await db.query(
      `SELECT id, conversation_id, reasoning_logs_id, status, attempts
       FROM mojomo.message_queue
       WHERE status = $1 AND attempts < max_attempts
       ORDER BY created_at ASC
       LIMIT $2`,
      ['pending', maxConcurrent]
    );

    if (jobs.rows.length === 0) {
      return;
    }

    const promises = jobs.rows.map((job: QueueJob) =>
      processJob(job).catch((err) =>
        console.error(`Error processing job ${job.id}:`, err)
      )
    );

    await Promise.allSettled(promises);
  } catch (error) {
    console.error('Error fetching jobs from queue:', error);
  }
}

async function processJob(job: QueueJob): Promise<void> {
  try {
    // Mark as processing
    await db.query(
      `UPDATE mojomo.message_queue
       SET status = $1, started_at = NOW(), attempts = attempts + 1
       WHERE id = $2`,
      ['processing', job.id]
    );

    // Fetch reasoning log
    const reasoningLog = await db.query(
      'SELECT * FROM mojomo.reasoning_logs WHERE id = $1',
      [job.reasoning_logs_id]
    );

    if (reasoningLog.rows.length === 0) {
      throw new Error('Reasoning log not found');
    }

    const reasoning = reasoningLog.rows[0];

    // Fetch conversation messages
    const messages = await db.query(
      `SELECT avatar_id, message_content, created_at
       FROM mojomo.conversation_messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC`,
      [job.conversation_id]
    );

    // Call Claude
    const result = await claudeService.callClaudeReasoning({
      conversation_id: job.conversation_id,
      messages: messages.rows.map((r: any) => ({
        avatar_id: r.avatar_id,
        content: r.message_content,
        created_at: new Date(r.created_at),
      })),
      prompt_override: reasoning.prompt,
    });

    // Update reasoning log with response
    await db.query(
      `UPDATE mojomo.reasoning_logs
       SET status = $1, response = $2, tokens_used = $3, cost = $4, completed_at = NOW()
       WHERE id = $5`,
      ['completed', JSON.stringify(result.response), result.tokensUsed, result.cost, job.reasoning_logs_id]
    );

    // Update queue job
    await db.query(
      `UPDATE mojomo.message_queue
       SET status = $1, result = $2, completed_at = NOW()
       WHERE id = $3`,
      ['completed', JSON.stringify(result.response), job.id]
    );

    console.log(`Completed reasoning job ${job.id}`);
  } catch (error: any) {
    console.error(`Error processing job ${job.id}:`, error.message);

    // Update reasoning log with error
    await db.query(
      `UPDATE mojomo.reasoning_logs
       SET status = $1, error_message = $2
       WHERE id = $3`,
      ['error', error.message, job.reasoning_logs_id]
    );

    // Increment attempts
    const updateResult = await db.query(
      `UPDATE mojomo.message_queue
       SET status = $1, error_message = $2, attempts = attempts + 1
       WHERE id = $3
       RETURNING attempts, max_attempts`,
      ['pending', error.message, job.id]
    );

    if (updateResult.rows.length > 0) {
      const { attempts, max_attempts } = updateResult.rows[0];
      if (attempts >= max_attempts) {
        await db.query(
          'UPDATE mojomo.message_queue SET status = $1 WHERE id = $2',
          ['failed', job.id]
        );
        console.log(`Job ${job.id} failed after ${attempts} attempts`);
      }
    }
  }
}

export { processJob };

export async function queueMessageForProcessing(
  messageId: string,
  conversationId: string
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO mojomo.message_queue (conversation_id, status)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [conversationId, 'pending']
    );
  } catch (error) {
    console.error(`Error queueing message ${messageId}:`, error);
  }
}
