import * as messagesClaude from '../../src/services/messages-claude';

describe('Sprint 9: Message Enhancement - Claude Integration', () => {
  describe('sanitizeMessageContent', () => {
    test('removes control characters', () => {
      const input = 'Hello\x00World\x1F';
      const result = messagesClaude.sanitizeMessageContent(input);
      expect(result).not.toContain('\x00');
      expect(result).not.toContain('\x1F');
    });

    test('truncates long messages', () => {
      const longMessage = 'a'.repeat(10000);
      const result = messagesClaude.sanitizeMessageContent(longMessage);
      expect(result.length).toBeLessThanOrEqual(5000);
    });

    test('preserves valid content', () => {
      const input = 'Hello world! How are you?';
      const result = messagesClaude.sanitizeMessageContent(input);
      expect(result).toContain('Hello');
      expect(result).toContain('world');
    });

    test('trims whitespace', () => {
      const input = '  Hello  ';
      const result = messagesClaude.sanitizeMessageContent(input);
      expect(result).toBe('Hello');
    });
  });

  describe('extractIdeasFromMessage', () => {
    test('extracts IDEA: marked ideas', async () => {
      const content = 'IDEA: Combine approach A with approach B for better results';
      const ideas = await messagesClaude.extractIdeasFromMessage('conv-1', content);
      expect(ideas.length).toBeGreaterThan(0);
      expect(ideas[0].source).toBe('marker');
    });

    test('extracts ideas with high confidence keywords', async () => {
      const content = 'I discovered a novel approach to solving this problem';
      const ideas = await messagesClaude.extractIdeasFromMessage('conv-1', content);
      expect(ideas.length).toBeGreaterThan(0);
    });

    test('limits to 3 ideas per message', async () => {
      const content =
        'IDEA: One idea\nIDEA: Two ideas\nIDEA: Three ideas\nIDEA: Four ideas';
      const ideas = await messagesClaude.extractIdeasFromMessage('conv-1', content);
      expect(ideas.length).toBeLessThanOrEqual(3);
    });

    test('returns empty array for content with no ideas', async () => {
      const content = 'Just a regular message with no special ideas';
      const ideas = await messagesClaude.extractIdeasFromMessage('conv-1', content);
      expect(Array.isArray(ideas)).toBe(true);
    });
  });

  describe('scoreMessageForIdeas', () => {
    test('scores higher for longer messages', () => {
      const short = 'Hi';
      const long = 'This is a detailed message with substantial content about ideas';
      const shortScore = messagesClaude.scoreMessageForIdeas(short);
      const longScore = messagesClaude.scoreMessageForIdeas(long);
      expect(longScore).toBeGreaterThan(shortScore);
    });

    test('scores higher for questions', () => {
      const noQuestions = 'This is a statement';
      const withQuestions = 'What if we did this? Could this work? Should we try it?';
      const noQScore = messagesClaude.scoreMessageForIdeas(noQuestions);
      const qScore = messagesClaude.scoreMessageForIdeas(withQuestions);
      expect(qScore).toBeGreaterThan(noQScore);
    });

    test('scores high for IDEA marker', () => {
      const noMarker = 'Just a regular message';
      const withMarker = 'IDEA: This is an important idea';
      const noMarkerScore = messagesClaude.scoreMessageForIdeas(noMarker);
      const markerScore = messagesClaude.scoreMessageForIdeas(withMarker);
      expect(markerScore).toBeGreaterThan(noMarkerScore);
    });

    test('returns score between 0 and 1', () => {
      const content = 'Test message IDEA: Something? Amazing!!';
      const score = messagesClaude.scoreMessageForIdeas(content);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    test('scores action-oriented messages higher', () => {
      const passive = 'The problem exists';
      const active = 'We could try this approach and test it';
      const passiveScore = messagesClaude.scoreMessageForIdeas(passive);
      const activeScore = messagesClaude.scoreMessageForIdeas(active);
      expect(activeScore).toBeGreaterThanOrEqual(passiveScore);
    });
  });
});
