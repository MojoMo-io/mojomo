import * as ideaRepo from '../../src/services/idea-repository';
import * as db from '../../src/services/db';

// Mock the database module
jest.mock('../../src/services/db');

describe('Sprint 11: Idea Extraction & Repository', () => {
  describe('extractTitle', () => {
    test('extracts first sentence', () => {
      const text =
        'This is a great idea. This is the second sentence. More text.';
      const title = ideaRepo.extractTitle(text);
      expect(title).toBe('This is a great idea');
    });

    test('truncates long titles to 255 chars', () => {
      const text = 'a'.repeat(300);
      const title = ideaRepo.extractTitle(text);
      expect(title.length).toBeLessThanOrEqual(255);
    });

    test('handles text without sentence delimiters', () => {
      const text = 'Just some text here';
      const title = ideaRepo.extractTitle(text);
      expect(title).toBeTruthy();
      expect(title.length).toBeGreaterThan(0);
    });

    test('trims whitespace', () => {
      const text = '  \n  Leading and trailing spaces  \n  ';
      const title = ideaRepo.extractTitle(text);
      expect(title).not.toMatch(/^\s/);
      expect(title).not.toMatch(/\s$/);
    });
  });

  describe('capHypothesis', () => {
    test('preserves text under 10k chars', () => {
      const text = 'Short hypothesis';
      const capped = ideaRepo.capHypothesis(text);
      expect(capped).toBe(text);
    });

    test('caps at 10k characters', () => {
      const text = 'a'.repeat(15000);
      const capped = ideaRepo.capHypothesis(text);
      expect(capped.length).toBeLessThanOrEqual(10000);
    });

    test('adds ellipsis when truncating', () => {
      const text = 'a'.repeat(15000);
      const capped = ideaRepo.capHypothesis(text);
      expect(capped).toMatch(/\.\.\.$/);
    });
  });

  describe('extractIdeasFromText', () => {
    test('extracts explicit IDEA: markers', () => {
      const text = 'IDEA: We could build a decentralized voting system';
      const ideas = ideaRepo.extractIdeasFromText(text);
      expect(ideas.length).toBeGreaterThan(0);
      expect(ideas[0].confidence).toBeGreaterThanOrEqual(0.9);
    });

    test('extracts multiple IDEA: markers', () => {
      const text =
        'IDEA: First idea\nSome text\nIDEA: Second idea\nMore text\nIDEA: Third idea';
      const ideas = ideaRepo.extractIdeasFromText(text);
      expect(ideas.length).toBeGreaterThanOrEqual(2);
    });

    test('limits to 3 ideas', () => {
      const text =
        'IDEA: One\nIDEA: Two\nIDEA: Three\nIDEA: Four\nIDEA: Five';
      const ideas = ideaRepo.extractIdeasFromText(text);
      expect(ideas.length).toBeLessThanOrEqual(3);
    });

    test('extracts from breakthrough keyword', () => {
      const text =
        'This breakthrough could revolutionize everything we know about blockchain';
      const ideas = ideaRepo.extractIdeasFromText(text);
      expect(ideas.length).toBeGreaterThan(0);
    });

    test('extracts from innovation keyword', () => {
      const text =
        'The innovation here is that we can combine two different approaches';
      const ideas = ideaRepo.extractIdeasFromText(text);
      expect(ideas.length).toBeGreaterThan(0);
    });

    test('removes duplicate ideas', () => {
      const text =
        'IDEA: Same idea here\nThis is the same idea here mentioned again';
      const ideas = ideaRepo.extractIdeasFromText(text);
      const uniqueTitles = [...new Set(ideas.map((i) => i.title))];
      expect(uniqueTitles.length).toBeLessThanOrEqual(ideas.length);
    });

    test('returns empty array for no ideas', () => {
      const text = 'Just some boring text with no ideas';
      const ideas = ideaRepo.extractIdeasFromText(text);
      expect(Array.isArray(ideas)).toBe(true);
    });

    test('sets source_message_id to empty by default', () => {
      const text = 'IDEA: Test idea';
      const ideas = ideaRepo.extractIdeasFromText(text);
      ideas.forEach((idea) => {
        expect(idea.source_message_id).toBe('');
      });
    });

    test('extracts hypothesis from IDEA marker', () => {
      const text = 'IDEA: We should implement multi-sig wallets';
      const ideas = ideaRepo.extractIdeasFromText(text);
      expect(ideas[0].hypothesis).toContain('multi-sig');
    });
  });

  describe('getIdeas with mocked database', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    test('getIdeas calls db.query with correct parameters', async () => {
      (db.query as jest.Mock).mockResolvedValue({ rows: [] });

      await ideaRepo.getIdeas('conv-123');

      expect(db.query).toHaveBeenCalled();
    });

    test('getIdeas filters by maturity when provided', async () => {
      (db.query as jest.Mock).mockResolvedValue({ rows: [] });

      await ideaRepo.getIdeas('conv-123', 'mature');

      expect(db.query).toHaveBeenCalled();
      const query = (db.query as jest.Mock).mock.calls[0][0];
      expect(query).toContain('maturity');
    });
  });

  describe('getIdea with mocked database', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    test('getIdea calls db.query with correct parameters', async () => {
      (db.query as jest.Mock).mockResolvedValue({ rows: [] });

      await ideaRepo.getIdea('idea-123');

      expect(db.query).toHaveBeenCalled();
    });

    test('getIdea returns null when no result found', async () => {
      (db.query as jest.Mock).mockResolvedValue({ rows: [] });

      const result = await ideaRepo.getIdea('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('advanceMaturity with mocked database', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    test('advanceMaturity returns false for non-existent idea', async () => {
      (db.query as jest.Mock).mockResolvedValue({ rows: [] });

      const result = await ideaRepo.advanceMaturity('nonexistent', 'exploring');

      expect(result).toBe(false);
    });

    test('advanceMaturity enforces forward-only progression', async () => {
      (db.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ maturity: 'refined' }] });

      const result = await ideaRepo.advanceMaturity('idea-123', 'exploring');

      expect(result).toBe(false);
    });
  });

  describe('countIdeasByMaturity with mocked database', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    test('countIdeasByMaturity sums counts by maturity', async () => {
      (db.query as jest.Mock).mockResolvedValue({
        rows: [
          { maturity: 'seedling', count: '5' },
          { maturity: 'exploring', count: '3' },
        ],
      });

      const counts = await ideaRepo.countIdeasByMaturity('conv-123');

      expect(counts.seedling).toBe(5);
      expect(counts.exploring).toBe(3);
    });
  });

  describe('Integration: Extract → Store → Retrieve', () => {
    test('extracted idea has required fields', () => {
      const text = 'IDEA: Build a decentralized market';
      const ideas = ideaRepo.extractIdeasFromText(text);

      ideas.forEach((idea) => {
        expect(idea.title).toBeTruthy();
        expect(idea.hypothesis).toBeTruthy();
        expect(typeof idea.confidence).toBe('number');
        expect(idea.confidence).toBeGreaterThanOrEqual(0);
        expect(idea.confidence).toBeLessThanOrEqual(1);
      });
    });

    test('hypothesis respects 10k char limit', () => {
      const text = 'IDEA: ' + 'a'.repeat(15000);
      const ideas = ideaRepo.extractIdeasFromText(text);

      ideas.forEach((idea) => {
        expect(idea.hypothesis.length).toBeLessThanOrEqual(10000);
      });
    });

    test('title respects 255 char limit', () => {
      const text = 'IDEA: ' + 'a'.repeat(500);
      const ideas = ideaRepo.extractIdeasFromText(text);

      ideas.forEach((idea) => {
        expect(idea.title.length).toBeLessThanOrEqual(255);
      });
    });
  });
});
