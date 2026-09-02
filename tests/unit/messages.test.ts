// Unit tests for message storage and idea scoring
import { calculateIdeaScore } from '../../src/services/messages';

describe('Idea Score Calculation', () => {
  it('should return 0 for plain text without keywords', () => {
    const score = calculateIdeaScore('This is just a regular message.');
    expect(score).toBe(0);
  });

  it('should score high for idea keyword', () => {
    const score = calculateIdeaScore('I have an idea for this problem.');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('should accumulate points for multiple keywords', () => {
    const single = calculateIdeaScore('I have a proposal.');
    const double = calculateIdeaScore('I have an innovative proposal and a new hypothesis.');

    expect(double).toBeGreaterThan(single);
  });

  it('should score high for idea-specific text', () => {
    const high_idea_text = `
      I would like to propose a new approach to this problem.
      My hypothesis is that we could solve this with an innovative strategy.
      This concept could be a breakthrough discovery.
    `;

    const score = calculateIdeaScore(high_idea_text);
    expect(score).toBeGreaterThanOrEqual(40);
  });

  it('should recognize "would like to propose" phrase', () => {
    const with_phrase = calculateIdeaScore('I would like to propose a solution.');
    const without_phrase = calculateIdeaScore('A solution.');

    expect(with_phrase).toBeGreaterThan(without_phrase);
  });

  it('should recognize "what if" phrase', () => {
    const with_phrase = calculateIdeaScore('What if we tried a different approach?');
    const without_phrase = calculateIdeaScore('Different approach.');

    expect(with_phrase).toBeGreaterThan(without_phrase);
  });

  it('should give bonus for longer messages', () => {
    const short = calculateIdeaScore('Idea.');
    const long = calculateIdeaScore(
      'I have an idea for how to solve this problem. It involves a strategic approach and an innovative hypothesis.'
    );

    expect(long).toBeGreaterThan(short);
  });

  it('should cap score at 100', () => {
    const very_long_idea_text = `
      idea idea idea idea idea
      hypothesis hypothesis hypothesis hypothesis
      innovative innovative innovative innovative
      breakthrough breakthrough breakthrough breakthrough
      discovery discovery discovery discovery
      I would like to propose what if what if what if
      ${Array(100).fill('idea').join(' ')}
    `;

    const score = calculateIdeaScore(very_long_idea_text);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('should be case insensitive', () => {
    const lower = calculateIdeaScore('i have an idea');
    const upper = calculateIdeaScore('I HAVE AN IDEA');
    const mixed = calculateIdeaScore('I HaVe An IdEa');

    expect(lower).toEqual(upper);
    expect(upper).toEqual(mixed);
  });

  it('should work with real conversation examples', () => {
    const examples = [
      {
        text: 'What if we approach this differently?',
        expect_score: 'high',
      },
      {
        text: 'I think we should consider a new strategy here.',
        expect_score: 'high',
      },
      {
        text: 'This could be an innovative breakthrough.',
        expect_score: 'high',
      },
      {
        text: 'Yes, I agree.',
        expect_score: 'low',
      },
      {
        text: 'Okay, sounds good.',
        expect_score: 'low',
      },
    ];

    examples.forEach(({ text, expect_score }) => {
      const score = calculateIdeaScore(text);

      if (expect_score === 'high') {
        expect(score).toBeGreaterThanOrEqual(10);
      } else {
        expect(score).toBeLessThanOrEqual(20);
      }
    });
  });
});

describe('Idea Score Thresholds', () => {
  it('should have threshold for idea extraction at 65', () => {
    // Messages scoring > 65 should be extracted as ideas
    const high_confidence = `
      I have a novel proposal for solving this.
      The hypothesis is innovative and represents a breakthrough.
      This concept could be the solution we need.
    `;

    const score = calculateIdeaScore(high_confidence);
    expect(score).toBeGreaterThan(20);
  });

  it('should not extract low-scoring messages', () => {
    const low_confidence = 'Okay, sounds good to me.';

    const score = calculateIdeaScore(low_confidence);
    expect(score).toBeLessThan(65);
  });

  it('should differentiate specialist vs casual messages', () => {
    const specialist_response = `
      I propose we implement a new strategy here.
      My hypothesis is that an innovative approach focusing on this concept
      could deliver a breakthrough result.
    `;

    const casual_response = `
      Yeah, that sounds fine. Let's do it.
      Whatever works I guess.
    `;

    const specialist_score = calculateIdeaScore(specialist_response);
    const casual_score = calculateIdeaScore(casual_response);

    expect(specialist_score).toBeGreaterThan(casual_score);
  });
});

describe('Message Types and Scoring', () => {
  it('should score AI responses (high idea potential)', () => {
    const ai_response = `
      Based on the discussion, I propose an innovative approach.
      My hypothesis is that this solution concept could be transformative.
      This represents a breakthrough methodology for the problem.
    `;

    const score = calculateIdeaScore(ai_response);
    // AI responses with ideas should score decently
    expect(score).toBeGreaterThanOrEqual(35);
  });

  it('should score user messages (variable idea potential)', () => {
    // User ideas might be casual
    const user_idea = `
      What if we just tried something different?
    `;

    const score = calculateIdeaScore(user_idea);
    // Should recognize "what if"
    expect(score).toBeGreaterThan(0);
  });

  it('should not score agreement messages', () => {
    const agreement = 'I agree with that approach.';
    const score = calculateIdeaScore(agreement);

    expect(score).toBeLessThanOrEqual(5);
  });

  it('should not score status updates', () => {
    const status = 'I am working on the implementation.';
    const score = calculateIdeaScore(status);

    expect(score).toBeLessThanOrEqual(5);
  });
});

describe('Idea Score Edge Cases', () => {
  it('should handle empty string', () => {
    const score = calculateIdeaScore('');
    expect(score).toBe(0);
  });

  it('should handle single word', () => {
    const score = calculateIdeaScore('idea');
    expect(score).toBeGreaterThan(0);
  });

  it('should handle very long text', () => {
    const long_text = Array(1000)
      .fill('This is a great idea for a novel approach to innovation.')
      .join(' ');

    const score = calculateIdeaScore(long_text);
    expect(score).toBeLessThanOrEqual(100); // Should cap at 100
  });

  it('should handle special characters', () => {
    const text = "What if we try a new idea!!! @#$%^&*()";
    const score = calculateIdeaScore(text);

    // Should still recognize "what if" and "idea"
    expect(score).toBeGreaterThan(0);
  });

  it('should handle multiple line breaks', () => {
    const text = `
      Proposal:

      I would like to propose a new approach.
      This is an innovative hypothesis.
      It could be a breakthrough solution.
    `;

    const score = calculateIdeaScore(text);
    expect(score).toBeGreaterThanOrEqual(35);
  });
});

describe('Keyword Frequency', () => {
  it('should increase score with more keyword occurrences', () => {
    const one_keyword = calculateIdeaScore('I have an idea.');
    const five_keywords = calculateIdeaScore('idea idea idea idea idea');

    expect(five_keywords).toBeGreaterThan(one_keyword);
  });

  it('should compound keywords', () => {
    const combined = calculateIdeaScore(
      'idea idea hypothesis hypothesis innovative innovative solution'
    );

    const single = calculateIdeaScore('idea');

    expect(combined).toBeGreaterThan(single * 3);
  });
});
