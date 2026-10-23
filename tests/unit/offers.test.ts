// Sprint 11 — offers.
//
// The tests that matter are the targeting ones. An offer that reaches the wrong
// agent is worse than an offer that reaches nobody, so every constraint gets a
// positive and a negative case.
import * as offers from '../../src/services/offers';

const base = {
  id: 'o1', sponsor_name: 'Acme', sponsor_url: null, title: 'Acme',
  brief: 'Worth a look?', value_prop: null, cta_url: null, cta_label: null,
  targeting: {} as Record<string, any>, price_cents: null, currency: 'USD',
  status: 'active', starts_at: null, ends_at: null, max_impressions_per_agent: 3,
};

const agent = {
  id: 'a1', capabilities: ['security-review', 'debugging'],
  model_family: 'claude', framework: 'langchain', country: 'GB',
  reputation_score: 40,
};

describe('matchesTargeting', () => {
  it('matches everyone when targeting is empty', () => {
    expect(offers.matchesTargeting(base as any, agent)).toBe(true);
  });

  it('matches when the agent has one of the wanted capabilities', () => {
    const o = { ...base, targeting: { capabilities: ['security-review', 'integration'] } };
    expect(offers.matchesTargeting(o as any, agent)).toBe(true);
  });

  it('does not match when the agent has none of the wanted capabilities', () => {
    const o = { ...base, targeting: { capabilities: ['design'] } };
    expect(offers.matchesTargeting(o as any, agent)).toBe(false);
  });

  it('matches capabilities case-insensitively', () => {
    const o = { ...base, targeting: { capabilities: ['SECURITY-REVIEW'] } };
    expect(offers.matchesTargeting(o as any, agent)).toBe(true);
  });

  it('matches model family', () => {
    const o = { ...base, targeting: { model_family: ['claude', 'gpt'] } };
    expect(offers.matchesTargeting(o as any, agent)).toBe(true);
  });

  it('rejects a different model family', () => {
    const o = { ...base, targeting: { model_family: ['gpt'] } };
    expect(offers.matchesTargeting(o as any, agent)).toBe(false);
  });

  it('rejects when the agent has no model family and one is required', () => {
    const o = { ...base, targeting: { model_family: ['claude'] } };
    expect(offers.matchesTargeting(o as any, { ...agent, model_family: null })).toBe(false);
  });

  it('matches framework', () => {
    const o = { ...base, targeting: { framework: ['langchain'] } };
    expect(offers.matchesTargeting(o as any, agent)).toBe(true);
  });

  it('matches country case-insensitively', () => {
    const o = { ...base, targeting: { country: ['gb'] } };
    expect(offers.matchesTargeting(o as any, agent)).toBe(true);
  });

  it('rejects a different country', () => {
    const o = { ...base, targeting: { country: ['US'] } };
    expect(offers.matchesTargeting(o as any, agent)).toBe(false);
  });

  it('enforces min_reputation', () => {
    const o = { ...base, targeting: { min_reputation: 50 } };
    expect(offers.matchesTargeting(o as any, agent)).toBe(false);
  });

  it('passes min_reputation when the agent is above it', () => {
    const o = { ...base, targeting: { min_reputation: 30 } };
    expect(offers.matchesTargeting(o as any, agent)).toBe(true);
  });

  it('treats a null reputation as zero', () => {
    const o = { ...base, targeting: { min_reputation: 1 } };
    expect(offers.matchesTargeting(o as any, { ...agent, reputation_score: null })).toBe(false);
  });

  it('requires every present constraint to match', () => {
    const o = { ...base, targeting: { capabilities: ['security-review'], country: ['US'] } };
    expect(offers.matchesTargeting(o as any, agent)).toBe(false);
  });
});
