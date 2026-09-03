import * as db from './db';

export interface SkillTag {
  id: string;
  avatar_id: string;
  skill_name: string;
  proficiency_level: 1 | 2 | 3 | 4 | 5;
  endorsement_count: number;
  created_at: Date;
}

export interface RequiredSkill {
  skill_name: string;
  proficiency_level: number;
  importance_weight: number;
  confidence: number;
}

export interface MatchResult {
  specialist_avatar_id: string;
  match_score: number;
  matched_skills: string[];
  missing_skills: string[];
  reason: string;
}

// Add skill to specialist
export async function addSkill(
  avatarId: string,
  skillName: string,
  proficiencyLevel: 1 | 2 | 3 | 4 | 5
): Promise<SkillTag> {
  const result = await db.query(
    `INSERT INTO specialist_skills (avatar_id, skill_name, proficiency_level, created_at)
     VALUES ($1, $2, $3, NOW())
     RETURNING id, avatar_id, skill_name, proficiency_level, endorsement_count, created_at`,
    [avatarId, skillName, proficiencyLevel]
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to add skill');
  }

  const row = result.rows[0];
  return {
    id: row.id,
    avatar_id: row.avatar_id,
    skill_name: row.skill_name,
    proficiency_level: row.proficiency_level,
    endorsement_count: row.endorsement_count || 0,
    created_at: new Date(row.created_at),
  };
}

// Get specialist skills
export async function getSpecialistSkills(avatarId: string): Promise<SkillTag[]> {
  const result = await db.query(
    `SELECT id, avatar_id, skill_name, proficiency_level, endorsement_count, created_at
     FROM specialist_skills WHERE avatar_id = $1 ORDER BY proficiency_level DESC`,
    [avatarId]
  );

  return result.rows.map((row: any) => ({
    id: row.id,
    avatar_id: row.avatar_id,
    skill_name: row.skill_name,
    proficiency_level: row.proficiency_level,
    endorsement_count: row.endorsement_count || 0,
    created_at: new Date(row.created_at),
  }));
}

// Extract requirements from idea hypothesis
export function extractRequirements(ideaHypothesis: string): RequiredSkill[] {
  const requirements: RequiredSkill[] = [];

  // Common skill keywords with proficiency inference
  const skillPatterns = [
    { skill: 'development', keywords: ['build', 'develop', 'code', 'implement'], minProf: 3 },
    { skill: 'design', keywords: ['design', 'architecture', 'ui', 'ux'], minProf: 2 },
    { skill: 'research', keywords: ['research', 'analyze', 'investigate', 'study'], minProf: 2 },
    { skill: 'marketing', keywords: ['market', 'promote', 'campaign', 'growth'], minProf: 2 },
    { skill: 'analysis', keywords: ['analyze', 'data', 'metrics', 'insights'], minProf: 2 },
  ];

  const lowerHypothesis = ideaHypothesis.toLowerCase();

  skillPatterns.forEach((pattern) => {
    const found = pattern.keywords.some((kw) => lowerHypothesis.includes(kw));

    if (found) {
      // Determine importance weight based on keyword frequency
      const frequency = pattern.keywords.filter((kw) =>
        lowerHypothesis.includes(kw)
      ).length;

      requirements.push({
        skill_name: pattern.skill,
        proficiency_level: pattern.minProf,
        importance_weight: Math.min(1.0, 0.5 + frequency * 0.2),
        confidence: 0.7,
      });
    }
  });

  return requirements;
}

// Calculate cosine similarity between skill vectors
export function calculateSimilarity(
  specialistSkills: SkillTag[],
  requiredSkills: RequiredSkill[]
): number {
  if (requiredSkills.length === 0) {
    return 0.5; // Neutral score if no requirements
  }

  let matchScore = 0;
  let totalWeight = 0;

  requiredSkills.forEach((req) => {
    const spec = specialistSkills.find(
      (s) => s.skill_name.toLowerCase() === req.skill_name.toLowerCase()
    );

    const weight = req.importance_weight;
    totalWeight += weight;

    if (spec) {
      // Score based on proficiency match
      const profMatch = Math.min(1.0, spec.proficiency_level / req.proficiency_level);
      const endorsementBonus = Math.min(0.1, spec.endorsement_count * 0.02);

      matchScore += weight * (profMatch + endorsementBonus);
    }
  });

  return totalWeight > 0 ? matchScore / totalWeight : 0;
}

// Find matching specialists for idea
export async function findMatches(
  ideaId: string,
  minScore: number = 0.65,
  limit: number = 5
): Promise<MatchResult[]> {
  // Get idea requirements
  const ideaResult = await db.query(
    `SELECT hypothesis FROM idea_repository WHERE id = $1`,
    [ideaId]
  );

  if (ideaResult.rows.length === 0) {
    throw new Error('Idea not found');
  }

  const hypothesis = ideaResult.rows[0].hypothesis;
  const requiredSkills = extractRequirements(hypothesis);

  if (requiredSkills.length === 0) {
    return [];
  }

  // Get all specialists
  const specialistsResult = await db.query(
    `SELECT DISTINCT avatar_id FROM specialist_skills`
  );

  const matches: MatchResult[] = [];

  for (const row of specialistsResult.rows) {
    const specialistSkills = await getSpecialistSkills(row.avatar_id);

    const score = calculateSimilarity(specialistSkills, requiredSkills);

    if (score >= minScore) {
      const matchedSkills = requiredSkills
        .filter((req) =>
          specialistSkills.some(
            (s) => s.skill_name.toLowerCase() === req.skill_name.toLowerCase()
          )
        )
        .map((r) => r.skill_name);

      const missingSkills = requiredSkills
        .filter((req) =>
          !specialistSkills.some(
            (s) => s.skill_name.toLowerCase() === req.skill_name.toLowerCase()
          )
        )
        .map((r) => r.skill_name);

      matches.push({
        specialist_avatar_id: row.avatar_id,
        match_score: Math.round(score * 100) / 100,
        matched_skills: matchedSkills,
        missing_skills: missingSkills,
        reason: `Matched ${matchedSkills.length}/${requiredSkills.length} skills`,
      });
    }
  }

  // Sort by score and return top matches
  return matches.sort((a, b) => b.match_score - a.match_score).slice(0, limit);
}

export default {
  addSkill,
  getSpecialistSkills,
  extractRequirements,
  calculateSimilarity,
  findMatches,
};
