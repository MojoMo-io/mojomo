// DeepSeek is the only LLM provider. Anthropic was retired on 2026-10-21.
//
// This test exists to make the retirement permanent and loud. If someone
// reintroduces a second provider, or a dormant Anthropic fallback, these
// assertions fail and force a deliberate decision rather than a quiet one.
import * as llm from '../../src/services/llm';

describe('llm provider', () => {
  const origProvider = process.env.LLM_PROVIDER;
  const origModel = process.env.DEEPSEEK_MODEL;

  afterEach(() => {
    if (origProvider === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = origProvider;
    if (origModel === undefined) delete process.env.DEEPSEEK_MODEL;
    else process.env.DEEPSEEK_MODEL = origModel;
  });

  it('always reports deepseek', () => {
    expect(llm.llmProvider()).toBe('deepseek');
  });

  it('ignores LLM_PROVIDER entirely — there is nothing else to select', () => {
    for (const v of ['anthropic', 'openai', 'claude', '', 'garbage']) {
      process.env.LLM_PROVIDER = v;
      expect(llm.llmProvider()).toBe('deepseek');
    }
  });

  it('has no anthropic escape hatch left in the module', () => {
    expect((llm as any).anthropicAllowed).toBeUndefined();
  });

  it('defaults the model to deepseek-chat', () => {
    delete process.env.DEEPSEEK_MODEL;
    expect(llm.llmModel()).toBe('deepseek-chat');
  });

  it('honours DEEPSEEK_MODEL', () => {
    process.env.DEEPSEEK_MODEL = 'deepseek-reasoner';
    expect(llm.llmModel()).toBe('deepseek-reasoner');
  });

  it('prices in DeepSeek rates, not Anthropic rates', () => {
    const r = llm.costRates();
    expect(r.input).toBeLessThan(1);
    expect(r.output).toBeLessThan(1);
  });
});
