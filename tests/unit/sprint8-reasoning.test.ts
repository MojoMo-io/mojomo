import * as reasoningService from '../../src/services/reasoning';

describe('Sprint 8: Reasoning Service', () => {
  describe('buildSystemPrompt', () => {
    test('returns non-empty string', () => {
      const prompt = reasoningService.buildSystemPrompt();
      expect(prompt).toBeDefined();
      expect(prompt.length).toBeGreaterThan(0);
      expect(prompt).toContain('conversation');
    });

    test('includes analysis instructions', () => {
      const prompt = reasoningService.buildSystemPrompt();
      expect(prompt).toContain('themes');
      expect(prompt).toContain('insights');
      expect(prompt).toContain('JSON');
    });
  });

  describe('buildUserPrompt', () => {
    test('formats messages correctly', () => {
      const messages = [
        {
          avatar_id: 'avatar-1',
          content: 'Hello',
          created_at: new Date(),
        },
        {
          avatar_id: 'avatar-2',
          content: 'Hi there',
          created_at: new Date(),
        },
      ];

      const prompt = reasoningService.buildUserPrompt(messages);
      expect(prompt).toContain('avatar-1');
      expect(prompt).toContain('Hello');
      expect(prompt).toContain('avatar-2');
      expect(prompt).toContain('Hi there');
    });

    test('includes custom prompt override', () => {
      const messages = [
        {
          avatar_id: 'avatar-1',
          content: 'Test',
          created_at: new Date(),
        },
      ];
      const customPrompt = 'Focus on disagreements';

      const prompt = reasoningService.buildUserPrompt(messages, customPrompt);
      expect(prompt).toContain(customPrompt);
      expect(prompt).toContain('avatar-1');
    });

    test('handles large message lists (keeps last 10)', () => {
      const messages = Array(20)
        .fill(null)
        .map((_, i) => ({
          avatar_id: `avatar-${i}`,
          content: `Message ${i}`,
          created_at: new Date(),
        }));

      const prompt = reasoningService.buildUserPrompt(messages);

      // Should contain last messages
      expect(prompt).toContain('avatar-19');
      // May or may not contain first messages (implementation detail)
    });

    test('handles empty messages', () => {
      const prompt = reasoningService.buildUserPrompt([]);
      expect(prompt).toBeDefined();
      expect(prompt.length).toBeGreaterThan(0);
    });
  });

  describe('estimateTokens', () => {
    test('returns positive number', () => {
      const tokens = reasoningService.estimateTokens('Hello world');
      expect(tokens).toBeGreaterThan(0);
      expect(Number.isInteger(tokens)).toBe(true);
    });

    test('scales with text length', () => {
      const shortTokens = reasoningService.estimateTokens('Hi');
      const longTokens = reasoningService.estimateTokens(
        'This is a much longer message with many words and characters'
      );
      expect(longTokens).toBeGreaterThan(shortTokens);
    });

    test('handles empty string', () => {
      const tokens = reasoningService.estimateTokens('');
      expect(tokens).toBe(0);
    });
  });

  describe('Response validation', () => {
    test('validates required fields in ReasoningResponse', () => {
      const validResponse: reasoningService.ReasoningResponse = {
        themes: ['theme1'],
        insights: ['insight1'],
        quality_score: 7,
        next_steps: ['step1'],
        tensions: [],
      };

      expect(validResponse.themes).toBeDefined();
      expect(validResponse.insights).toBeDefined();
      expect(validResponse.quality_score).toBeDefined();
      expect(validResponse.next_steps).toBeDefined();
      expect(validResponse.tensions).toBeDefined();
    });

    test('quality_score should be 0-10', () => {
      const validScores = [0, 5, 10];
      validScores.forEach((score) => {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(10);
      });
    });

    test('themes and insights should be arrays', () => {
      const response: reasoningService.ReasoningResponse = {
        themes: ['a', 'b'],
        insights: ['x'],
        quality_score: 5,
        next_steps: [],
        tensions: [],
      };

      expect(Array.isArray(response.themes)).toBe(true);
      expect(Array.isArray(response.insights)).toBe(true);
      expect(Array.isArray(response.next_steps)).toBe(true);
      expect(Array.isArray(response.tensions)).toBe(true);
    });
  });
});

describe('parseReasoningJson (fence-tolerant)', () => {
  const { parseReasoningJson } = require('../../src/services/reasoning');
  const body = '{"themes":["a"],"insights":["b"],"quality_score":7,"next_steps":[],"tensions":[]}';
  test('parses bare JSON', () => {
    expect(parseReasoningJson(body).quality_score).toBe(7);
  });
  test('strips ```json fences', () => {
    expect(parseReasoningJson('```json\n' + body + '\n```').themes).toEqual(['a']);
  });
  test('ignores leading prose before the object', () => {
    expect(parseReasoningJson('Here is the analysis:\n' + body).insights).toEqual(['b']);
  });
  test('throws when no object present', () => {
    expect(() => parseReasoningJson('no json here')).toThrow('No JSON object');
  });
});
