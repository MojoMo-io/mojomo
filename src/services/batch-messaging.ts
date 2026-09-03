import * as db from './db';
import * as ideaRepo from './idea-repository';

export interface BatchedMessage {
  conversation_id: string;
  sender_avatar_id: string;
  content: string;
  created_at: Date;
}

export interface BatchProcessingResult {
  messages_processed: number;
  ideas_extracted: number;
  batch_duration_ms: number;
}

interface MessageBatch {
  messages: BatchedMessage[];
  startTime: number;
}

const batches = new Map<string, MessageBatch>();
const BATCH_WINDOW_MS = 100;
const BATCH_SIZE_LIMIT = 50;

// Add message to batch
export function addMessageToBatch(message: BatchedMessage): void {
  const batchKey = message.conversation_id;

  if (!batches.has(batchKey)) {
    batches.set(batchKey, {
      messages: [],
      startTime: Date.now(),
    });
  }

  const batch = batches.get(batchKey)!;
  batch.messages.push(message);
}

// Process accumulated batches
export async function processPendingBatches(): Promise<BatchProcessingResult[]> {
  const results: BatchProcessingResult[] = [];
  const now = Date.now();

  for (const [batchKey, batch] of batches.entries()) {
    const timeElapsed = now - batch.startTime;

    // Process if batch is old enough or full
    if (
      batch.messages.length >= BATCH_SIZE_LIMIT ||
      timeElapsed >= BATCH_WINDOW_MS
    ) {
      const result = await processBatch(batch.messages);
      results.push(result);
      batches.delete(batchKey);
    }
  }

  return results;
}

// Process a single batch
async function processBatch(
  messages: BatchedMessage[]
): Promise<BatchProcessingResult> {
  const startTime = Date.now();
  let ideasExtracted = 0;

  // Insert all messages in single transaction
  await db.query('BEGIN');

  try {
    for (const msg of messages) {
      // Insert message
      const result = await db.query(
        `INSERT INTO messages (conversation_id, sender_avatar_id, content, created_at)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [msg.conversation_id, msg.sender_avatar_id, msg.content, msg.created_at]
      );

      const messageId = result.rows[0].id;

      // Extract ideas
      const ideas = ideaRepo.extractIdeasFromText(msg.content);
      if (ideas.length > 0) {
        ideas.forEach((idea) => {
          idea.source_message_id = messageId;
        });

        const extractedIds = await ideaRepo.storeIdeas(
          msg.conversation_id,
          ideas
        );
        ideasExtracted += extractedIds.length;
      }
    }

    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }

  const duration = Date.now() - startTime;

  return {
    messages_processed: messages.length,
    ideas_extracted: ideasExtracted,
    batch_duration_ms: duration,
  };
}

export default {
  addMessageToBatch,
  processPendingBatches,
};
