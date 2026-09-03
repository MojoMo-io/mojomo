import * as db from './db';

export interface IdeaVersion {
  id: string;
  idea_id: string;
  version: number;
  author_avatar_id: string;
  title: string;
  hypothesis: string;
  created_at: Date;
  change_summary?: string;
}

export interface IdeaComment {
  id: string;
  idea_id: string;
  author_avatar_id: string;
  content: string;
  created_at: Date;
  updated_at?: Date;
}

export interface IdeaEndorsement {
  idea_id: string;
  avatar_id: string;
  endorsed_at: Date;
  weight: number;
}

export type IdeaStatus = 'seedling' | 'exploring' | 'refined' | 'implemented';

// Create idea version
export async function createIdeaVersion(
  ideaId: string,
  authorId: string,
  title: string,
  hypothesis: string,
  changeSummary?: string
): Promise<IdeaVersion> {
  const result = await db.query(
    `INSERT INTO idea_versions (idea_id, author_avatar_id, title, hypothesis, change_summary, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     RETURNING id, idea_id, version, author_avatar_id, title, hypothesis, created_at`,
    [ideaId, authorId, title, hypothesis, changeSummary || '']
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to create idea version');
  }

  const row = result.rows[0];
  return {
    id: row.id,
    idea_id: row.idea_id,
    version: row.version,
    author_avatar_id: row.author_avatar_id,
    title: row.title,
    hypothesis: row.hypothesis,
    created_at: new Date(row.created_at),
    change_summary: changeSummary,
  };
}

// Get all versions of an idea
export async function getIdeaVersions(ideaId: string): Promise<IdeaVersion[]> {
  const result = await db.query(
    `SELECT id, idea_id, version, author_avatar_id, title, hypothesis, created_at, change_summary
     FROM idea_versions WHERE idea_id = $1 ORDER BY version DESC`,
    [ideaId]
  );

  return result.rows.map((row: any) => ({
    id: row.id,
    idea_id: row.idea_id,
    version: row.version,
    author_avatar_id: row.author_avatar_id,
    title: row.title,
    hypothesis: row.hypothesis,
    created_at: new Date(row.created_at),
    change_summary: row.change_summary,
  }));
}

// Add comment to idea
export async function addComment(
  ideaId: string,
  authorId: string,
  content: string
): Promise<IdeaComment> {
  const result = await db.query(
    `INSERT INTO idea_comments (idea_id, author_avatar_id, content, created_at)
     VALUES ($1, $2, $3, NOW())
     RETURNING id, idea_id, author_avatar_id, content, created_at`,
    [ideaId, authorId, content]
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to add comment');
  }

  const row = result.rows[0];
  return {
    id: row.id,
    idea_id: row.idea_id,
    author_avatar_id: row.author_avatar_id,
    content: row.content,
    created_at: new Date(row.created_at),
  };
}

// Get comments on idea
export async function getComments(ideaId: string): Promise<IdeaComment[]> {
  const result = await db.query(
    `SELECT id, idea_id, author_avatar_id, content, created_at
     FROM idea_comments WHERE idea_id = $1 ORDER BY created_at DESC`,
    [ideaId]
  );

  return result.rows.map((row: any) => ({
    id: row.id,
    idea_id: row.idea_id,
    author_avatar_id: row.author_avatar_id,
    content: row.content,
    created_at: new Date(row.created_at),
  }));
}

// Endorse an idea
export async function endorseIdea(
  ideaId: string,
  avatarId: string,
  weight: number = 1.0
): Promise<IdeaEndorsement> {
  const result = await db.query(
    `INSERT INTO idea_endorsements (idea_id, avatar_id, weight, endorsed_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (idea_id, avatar_id) DO UPDATE SET weight = $3, endorsed_at = NOW()
     RETURNING idea_id, avatar_id, endorsed_at, weight`,
    [ideaId, avatarId, weight]
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to endorse idea');
  }

  const row = result.rows[0];
  return {
    idea_id: row.idea_id,
    avatar_id: row.avatar_id,
    endorsed_at: new Date(row.endorsed_at),
    weight: row.weight,
  };
}

// Get endorsement count for idea
export async function getEndorsementCount(ideaId: string): Promise<number> {
  const result = await db.query(
    `SELECT COUNT(*) as count, SUM(weight) as total_weight FROM idea_endorsements WHERE idea_id = $1`,
    [ideaId]
  );

  return result.rows[0]?.count || 0;
}

// Get endorsement weight
export async function getEndorsementWeight(ideaId: string): Promise<number> {
  const result = await db.query(
    `SELECT SUM(weight) as total_weight FROM idea_endorsements WHERE idea_id = $1`,
    [ideaId]
  );

  return parseFloat(result.rows[0]?.total_weight || '0');
}

// Update idea status (forward-only progression)
export async function updateIdeaStatus(
  ideaId: string,
  newStatus: IdeaStatus
): Promise<boolean> {
  const statusOrder = ['seedling', 'exploring', 'refined', 'implemented'];

  // Get current status
  const current = await db.query(
    `SELECT maturity FROM idea_repository WHERE id = $1`,
    [ideaId]
  );

  if (current.rows.length === 0) {
    throw new Error('Idea not found');
  }

  const currentStatus = current.rows[0].maturity;
  const currentIndex = statusOrder.indexOf(currentStatus);
  const newIndex = statusOrder.indexOf(newStatus);

  // Only allow forward progression
  if (newIndex <= currentIndex) {
    return false;
  }

  const result = await db.query(
    `UPDATE idea_repository SET maturity = $1, updated_at = NOW() WHERE id = $2`,
    [newStatus, ideaId]
  );

  return result.rowCount > 0;
}

// Get idea contributors
export async function getContributors(ideaId: string): Promise<any[]> {
  const result = await db.query(
    `SELECT DISTINCT author_avatar_id as avatar_id, COUNT(*) as contributions
     FROM idea_versions WHERE idea_id = $1
     GROUP BY author_avatar_id
     UNION
     SELECT DISTINCT author_avatar_id as avatar_id, COUNT(*) as contributions
     FROM idea_comments WHERE idea_id = $1
     GROUP BY author_avatar_id`,
    [ideaId]
  );

  return result.rows;
}

export default {
  createIdeaVersion,
  getIdeaVersions,
  addComment,
  getComments,
  endorseIdea,
  getEndorsementCount,
  getEndorsementWeight,
  updateIdeaStatus,
  getContributors,
};
