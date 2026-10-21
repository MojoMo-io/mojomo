import * as db from './db';
import * as claudeService from './claude';
import { storeReasoningOutcome } from './reasoning-outcome';
import { generateAvatarReply, MAX_CONVERSATION_TURNS } from './avatarChat';
import { synthesizePersonalityProfile } from './profileSynthesis';
import { storeMessage } from './messages';
import { syncConnection } from './connections';
import { runMaturationSweep } from './ideaMaturation';
import { surfacePendingIdeas } from './ideaSurfacing';

interface QueueJob {
  id: string;
  conversation_id: string | null;
  reasoning_logs_id: string | null;
  status: string;
  attempts: number;
  job_type: 'reasoning' | 'avatar_reply' | 'profile_synthesis' | 'external_sync' | 'idea_maturation';
  payload: Record<string, any> | null;
}

let isRunning = false;
let processInterval: ReturnType<typeof setInterval> | null = null;
let maturationInterval: ReturnType<typeof setInterval> | null = null;

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

  // Periodic idea-maturation sweep. Kept off the main interval so a slow sweep can't delay
  // avatar replies; the queue's own pending/processing guard prevents pile-up.
  const maturationMs = Number(process.env.IDEA_MATURATION_INTERVAL_MS || 15 * 60 * 1000);
  if (maturationMs > 0) {
    maturationInterval = setInterval(() => {
      queueIdeaMaturationJob().catch((err) => console.error('Failed to queue idea maturation:', err.message));
    }, maturationMs);
  }
}

export async function stopJobQueue(): Promise<void> {
  if (processInterval) {
    clearInterval(processInterval);
    processInterval = null;
  }
  if (maturationInterval) {
    clearInterval(maturationInterval);
    maturationInterval = null;
  }
  isRunning = false;
  console.log('Job queue stopped');
}

async function processNextBatch(maxConcurrent: number): Promise<void> {
  try {
    const jobs = await db.query(
      `SELECT id, conversation_id, reasoning_logs_id, status, attempts, job_type, payload
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
  await db.query(
    `UPDATE mojomo.message_queue
     SET status = $1, started_at = NOW(), attempts = attempts + 1
     WHERE id = $2`,
    ['processing', job.id]
  );

  if (job.job_type === 'avatar_reply') return processAvatarReplyJob(job);
  if (job.job_type === 'profile_synthesis') return processProfileSynthesisJob(job);
  if (job.job_type === 'external_sync') return processExternalSyncJob(job);
  if (job.job_type === 'idea_maturation') return processIdeaMaturationJob(job);
  return processReasoningJob(job);
}

/** Original behavior, unchanged - a job_type='reasoning' row is exactly what this always did. */
async function processReasoningJob(job: QueueJob): Promise<void> {
  try {
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
      conversation_id: job.conversation_id as string,
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

    // Persist as an ai_response message and extract an idea if idea_score > 0.65
    const outcome = await storeReasoningOutcome(job.conversation_id as string, job.reasoning_logs_id as string, result.response);
    // Update queue job
    await db.query(
      `UPDATE mojomo.message_queue
       SET status = $1, result = $2, completed_at = NOW()
       WHERE id = $3`,
      ['completed', JSON.stringify({ ...result.response, message_id: outcome.messageId, idea_id: outcome.ideaId }), job.id]
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
       SET status = $1, error_message = $2
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
      `INSERT INTO mojomo.message_queue (conversation_id, status, job_type)
       VALUES ($1, $2, 'reasoning')
       ON CONFLICT DO NOTHING`,
      [conversationId, 'pending']
    );
  } catch (error) {
    console.error(`Error queueing message ${messageId}:`, error);
  }
}

/** Enqueue the *other* avatar's next reply in an avatar-to-avatar conversation. */
export async function queueAvatarReplyJob(conversationId: string, replyingAvatarId: string): Promise<void> {
  await db.query(
    `INSERT INTO mojomo.message_queue (conversation_id, status, job_type, payload)
     VALUES ($1, 'pending', 'avatar_reply', $2)`,
    [conversationId, JSON.stringify({ replyingAvatarId })]
  );
}

/**
 * Enqueue a reasoning pass over a conversation's recent messages.
 *
 * processReasoningJob needs a reasoning_logs row to write its result into, so one is created
 * here. Skips if a reasoning job for this conversation is already pending/processing, so a
 * fast-moving avatar exchange doesn't pile up redundant analyses.
 */
export async function queueReasoningJobForConversation(conversationId: string): Promise<void> {
  const existing = await db.query(
    `SELECT 1 FROM mojomo.message_queue
     WHERE conversation_id = $1 AND job_type = 'reasoning' AND status IN ('pending', 'processing')
     LIMIT 1`,
    [conversationId]
  );
  if (existing.rows.length > 0) return;

  const log = await db.query(
    `INSERT INTO mojomo.reasoning_logs (conversation_id, prompt, status)
     VALUES ($1, $2, 'pending') RETURNING id`,
    [conversationId, 'Analyze the recent avatar-to-avatar exchange for themes, insights, and ideas.']
  );

  await db.query(
    `INSERT INTO mojomo.message_queue (conversation_id, reasoning_logs_id, status, job_type)
     VALUES ($1, $2, 'pending', 'reasoning')`,
    [conversationId, log.rows[0].id]
  );
}

/** Enqueue a maturation sweep. The queue runner schedules one periodically; see startJobQueue. */
export async function queueIdeaMaturationJob(): Promise<void> {
  const existing = await db.query(
    `SELECT 1 FROM mojomo.message_queue
     WHERE job_type = 'idea_maturation' AND status IN ('pending', 'processing') LIMIT 1`
  );
  if (existing.rows.length > 0) return;
  await db.query(
    `INSERT INTO mojomo.message_queue (conversation_id, status, job_type) VALUES (NULL, 'pending', 'idea_maturation')`
  );
}

/** Enqueue a personality-profile refresh for one avatar, from its private chat history. */
export async function queueProfileSynthesisJob(avatarId: string): Promise<void> {
  // Don't stack refreshes: one pending/processing synthesis per avatar is enough.
  const existing = await db.query(
    `SELECT 1 FROM mojomo.message_queue
     WHERE job_type = 'profile_synthesis' AND status IN ('pending', 'processing')
       AND payload->>'avatarId' = $1 LIMIT 1`,
    [avatarId]
  );
  if (existing.rows.length > 0) return;
  await db.query(
    `INSERT INTO mojomo.message_queue (conversation_id, status, job_type, payload)
     VALUES (NULL, 'pending', 'profile_synthesis', $1)`,
    [JSON.stringify({ avatarId })]
  );
}

/** Enqueue a re-sync of one external connector connection (fetch + refresh profile inputs). */
export async function queueExternalSyncJob(connectionId: string): Promise<void> {
  await db.query(
    `INSERT INTO mojomo.message_queue (conversation_id, status, job_type, payload)
     VALUES (NULL, 'pending', 'external_sync', $1)`,
    [JSON.stringify({ connectionId })]
  );
}

async function processAvatarReplyJob(job: QueueJob): Promise<void> {
  try {
    const replyingAvatarId: string = job.payload?.replyingAvatarId;
    const conversationId = job.conversation_id as string;
    if (!replyingAvatarId || !conversationId) throw new Error('avatar_reply job missing conversation/avatar');

    const convRes = await db.query('SELECT * FROM mojomo.conversations WHERE id = $1', [conversationId]);
    if (convRes.rows.length === 0) throw new Error('Conversation not found');
    const conversation = convRes.rows[0];
    if (conversation.status === 'ended') {
      await db.query(`UPDATE mojomo.message_queue SET status = 'completed', completed_at = NOW() WHERE id = $1`, [job.id]);
      return;
    }

    const otherAvatarId =
      conversation.initiator_avatar_id === replyingAvatarId ? conversation.target_avatar_id : conversation.initiator_avatar_id;

    const [speakerRes, otherRes, historyRes, countRes] = await Promise.all([
      db.query('SELECT * FROM mojomo.avatars WHERE id = $1', [replyingAvatarId]),
      db.query('SELECT name FROM mojomo.avatars WHERE id = $1', [otherAvatarId]),
      db.query(
        'SELECT avatar_id, message_content FROM mojomo.conversation_messages WHERE conversation_id = $1 ORDER BY created_at ASC',
        [conversationId]
      ),
      db.query('SELECT COUNT(*)::int AS n FROM mojomo.conversation_messages WHERE conversation_id = $1', [conversationId]),
    ]);
    if (speakerRes.rows.length === 0 || otherRes.rows.length === 0) throw new Error('Avatar not found');

    if (countRes.rows[0].n >= MAX_CONVERSATION_TURNS) {
      await db.query(`UPDATE mojomo.conversations SET status = 'ended', ended_at = NOW() WHERE id = $1`, [conversationId]);
      await db.query(`UPDATE mojomo.message_queue SET status = 'completed', completed_at = NOW() WHERE id = $1`, [job.id]);
      return;
    }

    const replyText = await generateAvatarReply(speakerRes.rows[0], otherRes.rows[0].name, historyRes.rows);
    const message = await storeMessage(conversationId, replyingAvatarId, replyText, 'avatar_message');

    await db.query(
      `UPDATE mojomo.message_queue SET status = 'completed', result = $1, completed_at = NOW() WHERE id = $2`,
      [JSON.stringify({ message_id: message.id }), job.id]
    );

    // Analyze the exchange so ideas surface from avatar-to-avatar dialogue, not just from
    // human-driven reasoning jobs. Without this the idea_repository never sees avatar messages.
    await queueReasoningJobForConversation(conversationId).catch((err) =>
      console.error(`Failed to queue reasoning for conversation ${conversationId}:`, err.message)
    );

    // Keep the exchange going: the other avatar gets to reply next, up to the turn cap above.
    if (countRes.rows[0].n + 1 < MAX_CONVERSATION_TURNS) {
      await queueAvatarReplyJob(conversationId, otherAvatarId);
    }
  } catch (error: any) {
    console.error(`Error processing avatar_reply job ${job.id}:`, error.message);
    await failJob(job, error.message);
  }
}

async function processIdeaMaturationJob(job: QueueJob): Promise<void> {
  try {
    const results = await runMaturationSweep(Number(process.env.IDEA_MATURATION_BATCH || 50));
    const advanced = results.filter((r) => r.advanced).length;

    // Anything that just reached 'mature' gets surfaced to its people. Runs in the same job so
    // the email follows the promotion closely, and is idempotent if the job is retried.
    const surfaced = await surfacePendingIdeas(Number(process.env.IDEA_SURFACING_BATCH || 25));
    const notified = surfaced.reduce((n, s) => n + s.notified, 0);

    await db.query(
      `UPDATE mojomo.message_queue SET status = 'completed', result = $1, completed_at = NOW() WHERE id = $2`,
      [JSON.stringify({ examined: results.length, advanced, surfaced: surfaced.length, notified }), job.id]
    );
    if (advanced > 0) console.log(`Idea maturation: advanced ${advanced}/${results.length} ideas`);
    if (notified > 0) console.log(`Idea surfacing: emailed ${notified} participant(s) about ${surfaced.length} idea(s)`);
  } catch (error: any) {
    console.error(`Error processing idea_maturation job ${job.id}:`, error.message);
    await failJob(job, error.message);
  }
}

async function processProfileSynthesisJob(job: QueueJob): Promise<void> {
  try {
    const avatarId: string = job.payload?.avatarId;
    if (!avatarId) throw new Error('profile_synthesis job missing avatarId');
    await synthesizePersonalityProfile(avatarId);
    await db.query(`UPDATE mojomo.message_queue SET status = 'completed', completed_at = NOW() WHERE id = $1`, [job.id]);
  } catch (error: any) {
    console.error(`Error processing profile_synthesis job ${job.id}:`, error.message);
    await failJob(job, error.message);
  }
}

async function processExternalSyncJob(job: QueueJob): Promise<void> {
  try {
    const connectionId: string = job.payload?.connectionId;
    if (!connectionId) throw new Error('external_sync job missing connectionId');
    await syncConnection(connectionId);
    const connRes = await db.query(`SELECT avatar_id FROM mojomo.avatar_external_connections WHERE id = $1`, [connectionId]);
    if (connRes.rows.length > 0) await queueProfileSynthesisJob(connRes.rows[0].avatar_id);
    await db.query(`UPDATE mojomo.message_queue SET status = 'completed', completed_at = NOW() WHERE id = $1`, [job.id]);
  } catch (error: any) {
    console.error(`Error processing external_sync job ${job.id}:`, error.message);
    await failJob(job, error.message);
  }
}

async function failJob(job: QueueJob, errorMessage: string): Promise<void> {
  const updateResult = await db.query(
    `UPDATE mojomo.message_queue SET status = 'pending', error_message = $1 WHERE id = $2 RETURNING attempts, max_attempts`,
    [errorMessage, job.id]
  );
  if (updateResult.rows.length > 0) {
    const { attempts, max_attempts } = updateResult.rows[0];
    if (attempts >= max_attempts) {
      await db.query('UPDATE mojomo.message_queue SET status = $1 WHERE id = $2', ['failed', job.id]);
    }
  }
}
