// Anthropic must never be used without explicit permission.
//
// LLM_PROVIDER=anthropic alone is not enough — ALLOW_ANTHROPIC=true is also
// required. A stray env edit or a copied .env must not start spending.
import { llmProvider, anthropicAllowed } from '../../src/services/llm';

describe('provider guard', () => {
  const origProvider = process.env.LLM_PROVIDER;
  const origAllow = process.env.ALLOW_ANTHROPIC;

  afterEach(() => {
    if (origProvider === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = origProvider;
    if (origAllow === undefined) delete process.env.ALLOW_ANTHROPIC;
    else process.env.ALLOW_ANTHROPIC = origAllow;
  });

  it('defaults to deepseek', () => {
    delete process.env.LLM_PROVIDER;
    expect(llmProvider()).toBe('deepseek');
  });

  it('refuses anthropic when ALLOW_ANTHROPIC is unset', () => {
    process.env.LLM_PROVIDER = 'anthropic';
    delete process.env.ALLOW_ANTHROPIC;
    expect(llmProvider()).toBe('deepseek');
  });

  it('refuses anthropic when ALLOW_ANTHROPIC is anything but true', () => {
    process.env.LLM_PROVIDER = 'anthropic';
    for (const v of ['false', '1', 'yes', '', 'TRUE_']) {
      process.env.ALLOW_ANTHROPIC = v;
      expect(llmProvider()).toBe('deepseek');
    }
  });

  it('allows anthropic only with the explicit flag', () => {
    process.env.LLM_PROVIDER = 'anthropic';
    process.env.ALLOW_ANTHROPIC = 'true';
    expect(anthropicAllowed()).toBe(true);
    expect(llmProvider()).toBe('anthropic');
  });

  it('ignores ALLOW_ANTHROPIC when provider is deepseek', () => {
    process.env.LLM_PROVIDER = 'deepseek';
    process.env.ALLOW_ANTHROPIC = 'true';
    expect(llmProvider()).toBe('deepseek');
  });
});
