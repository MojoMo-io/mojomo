import * as db from './db';
import * as claudeService from './claude';

// Sanitize input to prevent prompt injection
export function sanitizeMessageContent(content: string): string {
  return content
    .substring(0, 5000) // Max length
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control chars
    .trim();
}

// Extract ideas from text content
export interface ExtractedIdea {
  title: string;
  hypothesis: string;
  confidence: number;
  source: string;
}

export async function extractIdeasFromMessage(
  conversationId: string,
  messageContent: string
): Promise<ExtractedIdea[]> {
  const ideas: ExtractedIdea[] = [];

  // Check for IDEA: marker
  const ideaMarkers = messageContent.match(/IDEA:\s*([^\n]+)/gi);
  if (ideaMarkers && ideaMarkers.length > 0) {
    ideaMarkers.forEach((marker, idx) => {
      const title = marker.replace(/IDEA:\s*/i, '').substring(0, 255);
      ideas.push({
        title,
        hypothesis: messageContent,
        confidence: 0.85,
        source: 'marker',
      });
    });
  }

  // Extract ideas with high confidence keywords
  const highConfidenceKeywords = [
    'breakthrough',
    'innovation',
    'novel approach',
    'solution to',
    'discovered',
    'insight',
  ];
  
  highConfidenceKeywords.forEach((keyword) => {
    if (messageContent.toLowerCase().includes(keyword)) {
      const start = Math.max(
        0,
        messageContent.toLowerCase().indexOf(keyword) - 50
      );
      const end = Math.min(
        messageContent.length,
        messageContent.toLowerCase().indexOf(keyword) + 200
      );
      const extract = messageContent.substring(start, end).trim();

      ideas.push({
        title: `Idea related to: ${keyword}`,
        hypothesis: extract,
        confidence: 0.7,
        source: 'keyword',
      });
    }
  });

  return ideas.slice(0, 3); // Max 3 ideas per message
}

// Store extracted ideas in idea_repository
export async function storeIdeas(
  conversationId: string,
  avatarId: string,
  ideas: ExtractedIdea[]
): Promise<string[]> {
  const ideaIds: string[] = [];

  for (const idea of ideas) {
    const result = await db.query(
      `INSERT INTO mojomo.idea_repository (conversation_id, avatar_id, title, hypothesis, confidence, maturity, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING id`,
      [
        conversationId,
        avatarId,
        idea.title.substring(0, 255),
        idea.hypothesis.substring(0, 10000),
        idea.confidence,
        'seedling',
      ]
    );

    if (result.rows.length > 0) {
      ideaIds.push(result.rows[0].id);
    }
  }

  return ideaIds;
}

// Score message content for idea quality
export function scoreMessageForIdeas(content: string): number {
  let score = 0;

  // Length factor (0-0.2)
  score += Math.min(content.length / 500, 1) * 0.2;

  // Question marks (0-0.15)
  const questions = (content.match(/\?/g) || []).length;
  score += Math.min(questions / 3, 1) * 0.15;

  // Excitement markers (0-0.15)
  const excitement = (content.match(/[!]{2,}/g) || []).length;
  score += Math.min(excitement / 2, 1) * 0.15;

  // Action words (0-0.3)
  const actionWords = [
    'could',
    'should',
    'might',
    'try',
    'test',
    'explore',
    'consider',
  ];
  actionWords.forEach((word) => {
    if (content.toLowerCase().includes(word)) {
      score += 0.05;
    }
  });

  // IDEA marker (0-0.2)
  if (content.includes('IDEA:')) {
    score += 0.2;
  }

  return Math.min(score, 1.0);
}

export default {
  sanitizeMessageContent,
  extractIdeasFromMessage,
  storeIdeas,
  scoreMessageForIdeas,
};
