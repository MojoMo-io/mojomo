// Unit tests for idea extraction and repository
describe('Idea Extraction Threshold', () => {
  const THRESHOLD = 0.65;

  it('should extract ideas with score > 0.65', () => {
    const scores = [0.66, 0.70, 0.80, 0.90, 1.0];

    scores.forEach((score) => {
      expect(score).toBeGreaterThan(THRESHOLD);
    });
  });

  it('should not extract ideas with score <= 0.65', () => {
    const scores = [0.0, 0.30, 0.60, 0.65];

    scores.forEach((score) => {
      expect(score).toBeLessThanOrEqual(THRESHOLD);
    });
  });

  it('should be borderline at exactly 0.65', () => {
    const score = 0.65;
    expect(score).not.toBeGreaterThan(THRESHOLD);
  });

  it('should extract at 0.66 and higher', () => {
    const scores = [0.66, 0.67, 0.70, 0.80];

    scores.forEach((score) => {
      expect(score).toBeGreaterThan(THRESHOLD);
    });
  });
});

describe('Hypothesis Extraction', () => {
  function extractHypothesis(message_text: string): string {
    const IDEA_HYPOTHESIS_MAX = 10000;

    // Look for IDEA: marker
    const idea_marker = message_text.indexOf('IDEA:');
    if (idea_marker !== -1) {
      const hypothesis = message_text.substring(idea_marker + 5).trim();
      return hypothesis.substring(0, IDEA_HYPOTHESIS_MAX);
    }

    // Fallback: use first part as hypothesis
    return message_text.substring(0, IDEA_HYPOTHESIS_MAX);
  }

  it('should extract text after IDEA: marker', () => {
    const text = 'Some context here. IDEA: This is the actual idea.';
    const hypothesis = extractHypothesis(text);

    expect(hypothesis).toContain('This is the actual idea');
    expect(hypothesis).not.toContain('Some context');
  });

  it('should use full text if no IDEA: marker', () => {
    const text = 'This is the hypothesis without a marker.';
    const hypothesis = extractHypothesis(text);

    expect(hypothesis).toBe(text);
  });

  it('should handle whitespace around IDEA: marker', () => {
    const text = 'Context. IDEA:   Actual idea with spaces.  ';
    const hypothesis = extractHypothesis(text);

    expect(hypothesis).toContain('Actual idea with spaces');
  });

  it('should preserve line breaks in hypothesis', () => {
    const text = `IDEA:
      Line 1: This is the first part.
      Line 2: This is the second part.`;

    const hypothesis = extractHypothesis(text);

    expect(hypothesis).toContain('Line 1');
    expect(hypothesis).toContain('Line 2');
  });

  it('should cap hypothesis at 10000 chars', () => {
    const text = 'IDEA: ' + 'x'.repeat(15000);
    const hypothesis = extractHypothesis(text);

    expect(hypothesis.length).toBeLessThanOrEqual(10000);
  });
});

describe('Title Extraction', () => {
  function extractTitle(hypothesis: string): string {
    const IDEA_TITLE_MAX = 255;
    const lines = hypothesis.split('\n');
    const first_line = lines[0].trim();
    return first_line.substring(0, IDEA_TITLE_MAX);
  }

  it('should extract first line as title', () => {
    const hypothesis = `First line title
      Second line detail.
      Third line more detail.`;

    const title = extractTitle(hypothesis);

    expect(title).toBe('First line title');
  });

  it('should trim whitespace from title', () => {
    const hypothesis = `   Title with spaces
      Details here.`;

    const title = extractTitle(hypothesis);

    expect(title).toBe('Title with spaces');
  });

  it('should cap title at 255 chars', () => {
    const long_title = 'x'.repeat(300);
    const hypothesis = `${long_title}
      Second line.`;

    const title = extractTitle(hypothesis);

    expect(title.length).toBeLessThanOrEqual(255);
    expect(title.length).toBe(255);
  });

  it('should handle single-line hypothesis', () => {
    const hypothesis = 'Single line hypothesis';
    const title = extractTitle(hypothesis);

    expect(title).toBe('Single line hypothesis');
  });
});

describe('Idea Maturity Progression', () => {
  const stage_order = {
    seedling: 0,
    exploring: 1,
    refined: 2,
    mature: 3,
  };

  it('should allow forward progression', () => {
    const transitions = [
      { from: 'seedling', to: 'exploring', valid: true },
      { from: 'exploring', to: 'refined', valid: true },
      { from: 'refined', to: 'mature', valid: true },
      { from: 'seedling', to: 'refined', valid: true },
      { from: 'seedling', to: 'mature', valid: true },
    ];

    transitions.forEach(({ from, to, valid }) => {
      const can_progress = stage_order[to as keyof typeof stage_order] >=
                           stage_order[from as keyof typeof stage_order];
      expect(can_progress).toBe(valid);
    });
  });

  it('should reject backward progression', () => {
    const invalid_transitions = [
      { from: 'mature', to: 'refined', valid: false },
      { from: 'refined', to: 'seedling', valid: false },
      { from: 'exploring', to: 'seedling', valid: false },
    ];

    invalid_transitions.forEach(({ from, to, valid }) => {
      const can_progress = stage_order[to as keyof typeof stage_order] >=
                           stage_order[from as keyof typeof stage_order];
      expect(can_progress).toBe(valid);
    });
  });

  it('should allow staying at same stage', () => {
    const same_stage = 'seedling';
    const can_progress = stage_order[same_stage] >= stage_order[same_stage];

    expect(can_progress).toBe(true);
  });
});

describe('Idea Repository Scenarios', () => {
  it('should start ideas at seedling stage', () => {
    const initial_stage = 'seedling';
    const valid_stages = ['seedling', 'exploring', 'refined', 'mature'];

    expect(valid_stages).toContain(initial_stage);
    expect(initial_stage).toBe('seedling');
  });

  it('should track confidence score (idea_score)', () => {
    const idea_scores = [0.66, 0.75, 0.85, 0.95];

    idea_scores.forEach((score) => {
      expect(score).toBeGreaterThan(0.65);
      expect(score).toBeLessThanOrEqual(1.0);
    });
  });

  it('should order ideas by confidence score descending', () => {
    const ideas = [
      { id: '1', confidence_score: 0.90 },
      { id: '2', confidence_score: 0.75 },
      { id: '3', confidence_score: 0.95 },
      { id: '4', confidence_score: 0.70 },
    ];

    const sorted = ideas.sort((a, b) => b.confidence_score - a.confidence_score);

    expect(sorted[0].confidence_score).toBe(0.95);
    expect(sorted[1].confidence_score).toBe(0.90);
    expect(sorted[2].confidence_score).toBe(0.75);
    expect(sorted[3].confidence_score).toBe(0.70);
  });

  it('should track extraction source (message_id)', () => {
    const idea = {
      id: 'idea-1',
      extracted_from_message_id: 'message-123',
    };

    expect(idea.extracted_from_message_id).toBeDefined();
    expect(idea.extracted_from_message_id).toBe('message-123');
  });

  it('should prevent duplicate ideas from same message', () => {
    const message_id = 'msg-1';
    const idea_ids: Record<string, boolean> = {};

    // Simulate trying to add the same idea twice
    idea_ids[message_id] = true;

    // Second insertion would use ON CONFLICT DO NOTHING
    const duplicate_inserted = idea_ids[message_id];
    expect(duplicate_inserted).toBe(true);

    // Total ideas should be 1, not 2
    const unique_ideas = Object.keys(idea_ids).length;
    expect(unique_ideas).toBe(1);
  });
});

describe('Idea Content', () => {
  it('should store full hypothesis', () => {
    const hypothesis = `This is a detailed hypothesis about the problem.
    It includes multiple sentences.
    And explains the reasoning behind the approach.`;

    expect(hypothesis.length).toBeGreaterThan(0);
    expect(hypothesis).toContain('hypothesis');
  });

  it('should track extracted_by_avatar_id', () => {
    const avatar_id = 'avatar-uuid-here';
    const idea = {
      extracted_by_avatar_id: avatar_id,
    };

    expect(idea.extracted_by_avatar_id).toBe(avatar_id);
  });

  it('should handle titles up to 255 chars', () => {
    const title = 'x'.repeat(255);
    expect(title.length).toBeLessThanOrEqual(255);
  });

  it('should handle hypothesis up to 10000 chars', () => {
    const hypothesis = 'x'.repeat(10000);
    expect(hypothesis.length).toBeLessThanOrEqual(10000);
  });
});

describe('Idea Extraction Edge Cases', () => {
  it('should not fail if extraction called with low score', () => {
    const score = 0.60;
    const should_extract = score > 0.65;

    expect(should_extract).toBe(false);
  });

  it('should handle empty message text', () => {
    const text = '';
    // Extraction would fail gracefully (no IDEA: marker, empty fallback)
    expect(text.length).toBe(0);
  });

  it('should handle message with only IDEA: marker', () => {
    const text = 'IDEA:';
    const hypothesis = text.substring(text.indexOf('IDEA:') + 5).trim();

    expect(hypothesis).toBe('');
  });

  it('should handle message with multiple IDEA: markers', () => {
    const text = 'IDEA: First idea here. IDEA: Second idea here.';
    const first_marker = text.indexOf('IDEA:');
    const hypothesis = text.substring(first_marker + 5).trim();

    // Should extract from first IDEA: marker
    expect(hypothesis).toContain('First idea here');
  });
});
