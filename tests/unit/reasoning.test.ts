// Exercises callReasoning's real control flow with the LLM transport (src/services/llm) mocked.
const complete = jest.fn();
jest.mock('../../src/services/llm', () => ({
  ...jest.requireActual('../../src/services/llm'),
  complete: (...args: any[]) => complete(...args),
}));
import { callReasoning, buildSystemPrompt, buildUserPrompt, estimateTokens } from '../../src/services/reasoning';

const body = { themes: ['t'], insights: ['i'], quality_score: 7, next_steps: [], tensions: [], idea_score: 0.7, idea_hypothesis: 'IDEA: x' };
const llmReply = (text: string, inTok = 100, outTok = 50) => ({ text, inputTokens: inTok, outputTokens: outTok, model: 'deepseek-chat', provider: 'deepseek' as const });
const req = { conversation_id: 'c1', messages: [{ avatar_id: 'a', content: 'hello', created_at: new Date() }] };

beforeEach(() => { complete.mockReset(); jest.useFakeTimers({ advanceTimers: true }); });
afterEach(() => jest.useRealTimers());

test('prompt builders include idea_score/idea_hypothesis instructions and message history', () => {
  expect(buildSystemPrompt()).toMatch(/idea_score/); expect(buildSystemPrompt()).toMatch(/idea_hypothesis/);
  expect(buildUserPrompt(req.messages)).toContain('hello');
  expect(estimateTokens('abcdefgh')).toBe(2);
});

test('parses fenced JSON and computes cost from configurable rates', async () => {
  process.env.LLM_PROVIDER = 'deepseek';
  process.env.DEEPSEEK_COST_INPUT_PER_MTOK = '2'; process.env.DEEPSEEK_COST_OUTPUT_PER_MTOK = '10';
  complete.mockResolvedValue(llmReply('```json\n' + JSON.stringify(body) + '\n```', 1_000_000, 100_000));
  const r = await callReasoning(req);
  expect(r.response.idea_score).toBe(0.7);
  expect(r.tokensUsed).toBe(1_100_000);
  expect(r.cost).toBeCloseTo(2 + 1, 6);
  expect(complete).toHaveBeenCalledWith(expect.objectContaining({ maxTokens: 1024, json: true }), 1);
  delete process.env.DEEPSEEK_COST_INPUT_PER_MTOK; delete process.env.DEEPSEEK_COST_OUTPUT_PER_MTOK;
});

test('retries with backoff after a transient failure and then succeeds', async () => {
  complete.mockRejectedValueOnce(Object.assign(new Error('overloaded'), { status: 529 }))
          .mockResolvedValueOnce(llmReply(JSON.stringify(body)));
  const p = callReasoning(req, 3);
  await jest.advanceTimersByTimeAsync(1100);
  const r = await p;
  expect(complete).toHaveBeenCalledTimes(2);
  expect(r.response.quality_score).toBe(7);
});

test('unparseable output is retried and the last error is thrown after maxAttempts', async () => {
  complete.mockResolvedValue(llmReply('sorry, no json here'));
  const p = callReasoning(req, 2).catch((e) => e);
  await jest.advanceTimersByTimeAsync(1100);
  const err = await p;
  expect(err).toBeInstanceOf(Error);
  expect(err.message).toMatch(/No JSON object/);
  expect(complete).toHaveBeenCalledTimes(2);
});

test('empty model output is an error', async () => {
  complete.mockResolvedValue(llmReply(''));
  await expect(callReasoning(req, 1)).rejects.toThrow('No JSON object');
});
