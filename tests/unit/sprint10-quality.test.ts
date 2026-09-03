import * as qualityValidation from '../../src/services/quality-validation';

describe('Sprint 10: Reasoning Quality Validation', () => {
  const validResponse = {
    themes: ['theme1', 'theme2'],
    insights: ['insight1', 'insight2'],
    quality_score: 7,
    next_steps: ['step1'],
    tensions: [],
  };

  describe('checkCoherence', () => {
    test('accepts valid response structure', () => {
      const result = qualityValidation.checkCoherence(
        JSON.stringify(validResponse),
        validResponse
      );
      expect(result.score).toBeGreaterThan(0.8);
      expect(result.issues.length).toBe(0);
    });

    test('penalizes invalid response structure', () => {
      const result = qualityValidation.checkCoherence('{}', null);
      expect(result.score).toBeLessThan(1.0);
      expect(result.issues.length).toBeGreaterThan(0);
    });

    test('penalizes short responses', () => {
      const result = qualityValidation.checkCoherence('hi', validResponse);
      expect(result.issues.some((i) => i.includes('short'))).toBe(true);
    });

    test('validates quality_score range', () => {
      const badQuality = { ...validResponse, quality_score: 15 };
      const result = qualityValidation.checkCoherence(
        JSON.stringify(badQuality),
        badQuality
      );
      expect(result.issues.some((i) => i.includes('range'))).toBe(true);
    });
  });

  describe('checkRelevance', () => {
    test('accepts relevant response', () => {
      const result = qualityValidation.checkRelevance(
        validResponse,
        'conversation context'
      );
      expect(result.score).toBeGreaterThan(0.7);
    });

    test('penalizes generic themes', () => {
      const genericResponse = {
        ...validResponse,
        themes: ['thing', 'stuff', 'other'],
      };
      const result = qualityValidation.checkRelevance(
        genericResponse,
        'context'
      );
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.score).toBeLessThan(1.0);
    });

    test('penalizes missing insights', () => {
      const noInsights = { ...validResponse, insights: [] };
      const result = qualityValidation.checkRelevance(noInsights, 'context');
      expect(result.issues.some((i) => i.includes('insight'))).toBe(true);
    });

    test('penalizes short insights', () => {
      const shortInsights = {
        ...validResponse,
        insights: ['x', 'y', 'z'],
      };
      const result = qualityValidation.checkRelevance(
        shortInsights,
        'context'
      );
      expect(result.issues.length).toBeGreaterThan(0);
    });
  });

  describe('calculateConfidence', () => {
    test('calculates weighted average', () => {
      const confidence = qualityValidation.calculateConfidence(0.8, 0.9, 8);
      expect(confidence).toBeGreaterThan(0.5);
      expect(confidence).toBeLessThanOrEqual(1.0);
    });

    test('weights coherence and relevance equally', () => {
      const c1 = qualityValidation.calculateConfidence(1.0, 0.5, 5);
      const c2 = qualityValidation.calculateConfidence(0.5, 1.0, 5);
      expect(Math.abs(c1 - c2)).toBeLessThan(0.01);
    });

    test('returns between 0 and 1', () => {
      const confidence = qualityValidation.calculateConfidence(0.2, 0.3, 2);
      expect(confidence).toBeGreaterThanOrEqual(0);
      expect(confidence).toBeLessThanOrEqual(1);
    });
  });

  describe('validateQuality', () => {
    test('gives high score to valid response', () => {
      const result = qualityValidation.validateQuality(
        JSON.stringify(validResponse),
        validResponse,
        'context'
      );
      expect(result.overall).toBeGreaterThan(0.7);
      expect(result.issues.length).toBe(0);
    });

    test('includes all issues from checks', () => {
      const badResponse = { themes: ['thing'], insights: [], quality_score: 0 };
      const result = qualityValidation.validateQuality(
        'short',
        badResponse,
        'context'
      );
      expect(result.issues.length).toBeGreaterThan(0);
    });
  });

  describe('isQualityAcceptable', () => {
    test('accepts high quality scores', () => {
      const score: qualityValidation.QualityScore = {
        coherence: 0.9,
        relevance: 0.9,
        confidence: 0.85,
        overall: 0.9,
        issues: [],
      };
      expect(qualityValidation.isQualityAcceptable(score)).toBe(true);
    });

    test('rejects low quality scores', () => {
      const score: qualityValidation.QualityScore = {
        coherence: 0.3,
        relevance: 0.4,
        confidence: 0.35,
        overall: 0.35,
        issues: ['Multiple issues'],
      };
      expect(qualityValidation.isQualityAcceptable(score)).toBe(false);
    });

    test('rejects low confidence', () => {
      const score: qualityValidation.QualityScore = {
        coherence: 0.8,
        relevance: 0.8,
        confidence: 0.5,
        overall: 0.8,
        issues: [],
      };
      expect(qualityValidation.isQualityAcceptable(score)).toBe(false);
    });
  });
});
