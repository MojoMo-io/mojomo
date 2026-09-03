import * as db from './db';

export interface ImplementationContract {
  id: string;
  idea_id: string;
  specialist_avatar_id: string;
  status: 'proposed' | 'accepted' | 'rejected' | 'in_progress' | 'completed' | 'verified';
  reward_tokens: number;
  timeline_days: number;
  created_at: Date;
  accepted_at?: Date;
}

export interface Milestone {
  id: string;
  contract_id: string;
  title: string;
  description: string;
  target_date: Date;
  completed_at?: Date;
  verification_count: number;
}

export interface ImplementationReward {
  specialist_avatar_id: string;
  idea_id: string;
  base_reward: number;
  completion_bonus: number;
  early_completion_bonus: number;
  total_reward: number;
}

// Create implementation contract
export async function createContract(
  ideaId: string,
  specialistId: string,
  rewardTokens: number,
  timelineDays: number
): Promise<ImplementationContract> {
  const result = await db.query(
    `INSERT INTO implementation_contracts (idea_id, specialist_avatar_id, status, reward_tokens, timeline_days, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     RETURNING id, idea_id, specialist_avatar_id, status, reward_tokens, timeline_days, created_at`,
    [ideaId, specialistId, 'proposed', rewardTokens, timelineDays]
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to create contract');
  }

  const row = result.rows[0];
  return {
    id: row.id,
    idea_id: row.idea_id,
    specialist_avatar_id: row.specialist_avatar_id,
    status: row.status,
    reward_tokens: row.reward_tokens,
    timeline_days: row.timeline_days,
    created_at: new Date(row.created_at),
  };
}

// Accept contract
export async function acceptContract(contractId: string): Promise<boolean> {
  const result = await db.query(
    `UPDATE implementation_contracts 
     SET status = $1, accepted_at = NOW()
     WHERE id = $2 AND status = $3`,
    [contractId, 'accepted', 'proposed']
  );

  return result.rowCount > 0;
}

// Reject contract
export async function rejectContract(contractId: string): Promise<boolean> {
  const result = await db.query(
    `UPDATE implementation_contracts 
     SET status = $1
     WHERE id = $2 AND status = $3`,
    [contractId, 'rejected', 'proposed']
  );

  return result.rowCount > 0;
}

// Add milestone
export async function addMilestone(
  contractId: string,
  title: string,
  description: string,
  targetDate: Date
): Promise<Milestone> {
  const result = await db.query(
    `INSERT INTO implementation_milestones (contract_id, title, description, target_date, created_at)
     VALUES ($1, $2, $3, $4, NOW())
     RETURNING id, contract_id, title, description, target_date, completed_at, verification_count`,
    [contractId, title, description, targetDate]
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to add milestone');
  }

  const row = result.rows[0];
  return {
    id: row.id,
    contract_id: row.contract_id,
    title: row.title,
    description: row.description,
    target_date: new Date(row.target_date),
    completed_at: row.completed_at ? new Date(row.completed_at) : undefined,
    verification_count: row.verification_count || 0,
  };
}

// Complete milestone
export async function completeMilestone(milestoneId: string): Promise<boolean> {
  const result = await db.query(
    `UPDATE implementation_milestones 
     SET completed_at = NOW()
     WHERE id = $1 AND completed_at IS NULL`,
    [milestoneId]
  );

  return result.rowCount > 0;
}

// Get contract details
export async function getContract(contractId: string): Promise<ImplementationContract | null> {
  const result = await db.query(
    `SELECT id, idea_id, specialist_avatar_id, status, reward_tokens, timeline_days, created_at, accepted_at
     FROM implementation_contracts WHERE id = $1`,
    [contractId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    idea_id: row.idea_id,
    specialist_avatar_id: row.specialist_avatar_id,
    status: row.status,
    reward_tokens: row.reward_tokens,
    timeline_days: row.timeline_days,
    created_at: new Date(row.created_at),
    accepted_at: row.accepted_at ? new Date(row.accepted_at) : undefined,
  };
}

// Get milestones for contract
export async function getContractMilestones(contractId: string): Promise<Milestone[]> {
  const result = await db.query(
    `SELECT id, contract_id, title, description, target_date, completed_at, verification_count
     FROM implementation_milestones WHERE contract_id = $1 ORDER BY target_date ASC`,
    [contractId]
  );

  return result.rows.map((row: any) => ({
    id: row.id,
    contract_id: row.contract_id,
    title: row.title,
    description: row.description,
    target_date: new Date(row.target_date),
    completed_at: row.completed_at ? new Date(row.completed_at) : undefined,
    verification_count: row.verification_count || 0,
  }));
}

// Calculate implementation progress
export async function calculateProgress(contractId: string): Promise<number> {
  const result = await db.query(
    `SELECT COUNT(*) as total, 
            SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END) as completed
     FROM implementation_milestones WHERE contract_id = $1`,
    [contractId]
  );

  const row = result.rows[0];
  const total = parseInt(row.total || '0');
  const completed = parseInt(row.completed || '0');

  return total > 0 ? (completed / total) * 100 : 0;
}

// Calculate rewards for implementation
export function calculateRewards(
  baseReward: number,
  daysOnTime: boolean,
  earlyDays: number = 0
): ImplementationReward {
  const completionBonus = baseReward * 0.1; // 10% completion bonus
  const earlyBonus = earlyDays > 0 ? baseReward * 0.05 : 0; // 5% early bonus

  return {
    specialist_avatar_id: '',
    idea_id: '',
    base_reward: baseReward,
    completion_bonus: completionBonus,
    early_completion_bonus: earlyBonus,
    total_reward: baseReward + completionBonus + earlyBonus,
  };
}

// Mark contract complete
export async function completeContract(contractId: string): Promise<boolean> {
  const result = await db.query(
    `UPDATE implementation_contracts 
     SET status = $1
     WHERE id = $2 AND status = $3`,
    ['completed', contractId, 'in_progress']
  );

  return result.rowCount > 0;
}

// Verify contract completion
export async function verifyCompletion(contractId: string): Promise<boolean> {
  const result = await db.query(
    `UPDATE implementation_contracts 
     SET status = $1
     WHERE id = $2 AND status = $3`,
    ['verified', contractId, 'completed']
  );

  return result.rowCount > 0;
}

export default {
  createContract,
  acceptContract,
  rejectContract,
  addMilestone,
  completeMilestone,
  getContract,
  getContractMilestones,
  calculateProgress,
  calculateRewards,
  completeContract,
  verifyCompletion,
};
