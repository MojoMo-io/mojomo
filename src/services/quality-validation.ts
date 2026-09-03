export interface QualityScore {
  coherence: number;
  relevance: number;
  confidence: number;
  overall: number;
  issues: string[];
}

// Check if response is coherent (valid structure, no contradictions)
export function checkCoherence(responseText: string, responseJson: any): {
  score: number;
  issues: string[];
} {
  const issues: string[] = [];
  let score = 1.0;

  // Check if response has required fields
  if (!responseJson || typeof responseJson !== 'object') {
    issues.push('Response is not a valid object');
    score -= 0.3;
    return { score: Math.max(score, 0), issues };
  }

  if (responseJson.themes && !Array.isArray(responseJson.themes)) {
    issues.push('Themes field is not an array');
    score -= 0.2;
  }

  if (responseJson.insights && !Array.isArray(responseJson.insights)) {
    issues.push('Insights field is not an array');
    score -= 0.2;
  }

  if (
    responseJson.quality_score &&
    (typeof responseJson.quality_score !== 'number' ||
      responseJson.quality_score < 0 ||
      responseJson.quality_score > 10)
  ) {
    issues.push('Quality score out of range (0-10)');
    score -= 0.15;
  }

  // Check for empty arrays
  if (responseJson.themes && responseJson.themes.length === 0) {
    issues.push('No themes identified');
    score -= 0.1;
  }

  // Check for extremely short responses
  if (responseText.length < 50) {
    issues.push('Response too short');
    score -= 0.15;
  }

  return { score: Math.max(score, 0), issues };
}

// Check relevance to conversation context
export function checkRelevance(
  responseJson: any,
  conversationContext: string
): { score: number; issues: string[] } {
  const issues: string[] = [];
  let score = 1.0;

  if (!responseJson || typeof responseJson !== 'object') {
    issues.push('Response is not a valid object');
    return { score: 0, issues };
  }

  if (!responseJson.themes || responseJson.themes.length === 0) {
    issues.push('No themes to validate relevance');
    score -= 0.2;
    return { score, issues };
  }

  // Simple relevance check: ensure themes contain meaningful content
  responseJson.themes.forEach((theme: string) => {
    if (!theme || theme.length < 3) {
      issues.push(`Theme too short: "${theme}"`);
      score -= 0.1;
    }

    // Check if theme is too generic
    const genericWords = ['thing', 'stuff', 'other', 'etc', 'etc.', 'idk'];
    if (genericWords.some((w) => theme.toLowerCase().includes(w))) {
      issues.push(`Theme is too generic: "${theme}"`);
      score -= 0.15;
    }
  });

  // Validate insights exist and are meaningful
  if (responseJson.insights && Array.isArray(responseJson.insights)) {
    if (responseJson.insights.length === 0) {
      issues.push('No insights identified');
      score -= 0.2;
    }

    responseJson.insights.forEach((insight: string) => {
      if (!insight || insight.length < 5) {
        issues.push('Insight too short');
        score -= 0.1;
      }
    });
  }

  return { score: Math.max(score, 0), issues };
}

// Calculate confidence score based on quality metrics
export function calculateConfidence(
  coherenceScore: number,
  relevanceScore: number,
  qualityScoreFromResponse: number = 5
): number {
  // Weight: coherence 40%, relevance 40%, response quality 20%
  const confidence =
    coherenceScore * 0.4 +
    relevanceScore * 0.4 +
    (qualityScoreFromResponse / 10) * 0.2;

  return Math.min(Math.max(confidence, 0), 1);
}

// Overall quality validation
export function validateQuality(
  responseText: string,
  responseJson: any,
  conversationContext: string
): QualityScore {
  const coherence = checkCoherence(responseText, responseJson);
  const relevance = checkRelevance(responseJson, conversationContext);
  const confidence = calculateConfidence(
    coherence.score,
    relevance.score,
    responseJson?.quality_score || 5
  );

  const overall = (coherence.score + relevance.score) / 2;
  const allIssues = [...coherence.issues, ...relevance.issues];

  return {
    coherence: coherence.score,
    relevance: relevance.score,
    confidence,
    overall,
    issues: allIssues,
  };
}

// Check if quality is acceptable
export function isQualityAcceptable(score: QualityScore): boolean {
  return score.overall >= 0.65 && score.confidence >= 0.6;
}

export default {
  checkCoherence,
  checkRelevance,
  calculateConfidence,
  validateQuality,
  isQualityAcceptable,
};
