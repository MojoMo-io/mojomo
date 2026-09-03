import * as db from './db';

export interface ExtractedIdea {
  title: string;
  hypothesis: string;
  source_message_id: string;
  confidence: number;
}

export type IdeaMaturity = 'seedling' | 'exploring' | 'refined' | 'mature';

// Extract title from text (first sentence or key phrase, max 255 chars)
export function extractTitle(text: string): string {
  // Take first sentence or up to 255 chars
  const sentences = text.split(/[.!?]+/);
  let title = sentences[0].trim();

  if (title.length > 255) {
    title = title.substring(0, 252) + '...';
  }

  return title;
}

// Cap hypothesis at 10k chars
export function capHypothesis(text: string): string {
  if (text.length > 10000) {
    return text.substring(0, 9997) + '...';
  }
  return text;
}

// Extract ideas from message text using IDEA markers and heuristics
export function extractIdeasFromText(text: string): ExtractedIdea[] {
  const ideas: ExtractedIdea[] = [];

  // Look for explicit IDEA: markers (highest confidence)
  const ideaMarkerRegex = /IDEA:\s*(.+?)(?:\n|$)/gi;
  let match;
  while ((match = ideaMarkerRegex.exec(text)) !== null) {
    const hypothesis = match[1].trim();
    if (hypothesis.length > 5) {
      ideas.push({
        title: extractTitle(hypothesis),
        hypothesis: capHypothesis(hypothesis),
        source_message_id: '',
        confidence: 0.9,
      });
    }
  }

  // Look for high-confidence keywords (0.75 confidence)
  const keywords = [
    'breakthrough',
    'innovation',
    'novel approach',
    'solution',
    'discovered',
    'insight',
    'could',
    'should',
    'might',
  ];

  let extractedCount = 0;
  keywords.forEach((keyword) => {
    if (extractedCount < 3 && text.toLowerCase().includes(keyword)) {
      // Extract surrounding context
      const keywordIndex = text.toLowerCase().indexOf(keyword);
      const start = Math.max(0, keywordIndex - 50);
      const end = Math.min(text.length, keywordIndex + 200);
      const context = text.substring(start, end).trim();

      if (context.length > 10 && !context.includes('IDEA:')) {
        ideas.push({
          title: extractTitle(context),
          hypothesis: capHypothesis(context),
          source_message_id: '',
          confidence: 0.75,
        });
        extractedCount++;
      }
    }
  });

  // Remove duplicates by title
  const uniqueIdeas = ideas.filter(
    (idea, index, self) =>
      index ===
      self.findIndex(
        (t) =>
          t.title.toLowerCase() === idea.title.toLowerCase() &&
          t.confidence === idea.confidence
      )
  );

  return uniqueIdeas.slice(0, 3);
}

// Store extracted ideas in repository
export async function storeIdeas(
  conversationId: string,
  ideas: ExtractedIdea[]
): Promise<string[]> {
  const ideaIds: string[] = [];

  for (const idea of ideas) {
    const result = await db.query(
      `INSERT INTO idea_repository (
        conversation_id, title, hypothesis, source_message_id, 
        maturity, confidence, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING id`,
      [
        conversationId,
        idea.title,
        idea.hypothesis,
        idea.source_message_id,
        'seedling',
        idea.confidence,
      ]
    );
    ideaIds.push(result.rows[0].id);
  }

  return ideaIds;
}

// Get all ideas for a conversation
export async function getIdeas(
  conversationId: string,
  maturity?: IdeaMaturity
): Promise<any[]> {
  const query = `
    SELECT id, conversation_id, title, hypothesis, source_message_id,
           maturity, confidence, created_at, updated_at
    FROM idea_repository
    WHERE conversation_id = $1
    ${maturity ? 'AND maturity = $2' : ''}
    ORDER BY created_at DESC
  `;

  const params = maturity ? [conversationId, maturity] : [conversationId];
  const result = await db.query(query, params);
  return result.rows;
}

// Get single idea
export async function getIdea(ideaId: string): Promise<any> {
  const result = await db.query(
    `SELECT id, conversation_id, title, hypothesis, source_message_id,
            maturity, confidence, created_at, updated_at
     FROM idea_repository
     WHERE id = $1`,
    [ideaId]
  );

  return result.rows[0] || null;
}

// Advance maturity (forward-only: seedling → exploring → refined → mature)
export async function advanceMaturity(
  ideaId: string,
  targetMaturity: IdeaMaturity
): Promise<boolean> {
  const idea = await getIdea(ideaId);
  if (!idea) return false;

  const maturityLevels = ['seedling', 'exploring', 'refined', 'mature'];
  const currentIndex = maturityLevels.indexOf(idea.maturity);
  const targetIndex = maturityLevels.indexOf(targetMaturity);

  // Only allow forward progression
  if (targetIndex <= currentIndex) {
    return false;
  }

  const result = await db.query(
    `UPDATE idea_repository 
     SET maturity = $1, updated_at = NOW()
     WHERE id = $2`,
    [targetMaturity, ideaId]
  );

  return result.rowCount > 0;
}

// Count ideas by maturity
export async function countIdeasByMaturity(conversationId: string): Promise<{
  seedling: number;
  exploring: number;
  refined: number;
  mature: number;
}> {
  const result = await db.query(
    `SELECT maturity, COUNT(*) as count
     FROM idea_repository
     WHERE conversation_id = $1
     GROUP BY maturity`,
    [conversationId]
  );

  const counts = {
    seedling: 0,
    exploring: 0,
    refined: 0,
    mature: 0,
  };

  result.rows.forEach((row: any) => {
    counts[row.maturity as IdeaMaturity] = parseInt(row.count);
  });

  return counts;
}

export default {
  extractTitle,
  capHypothesis,
  extractIdeasFromText,
  storeIdeas,
  getIdeas,
  getIdea,
  advanceMaturity,
  countIdeasByMaturity,
};
