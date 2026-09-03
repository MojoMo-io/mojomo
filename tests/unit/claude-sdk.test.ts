// Exercises callClaudeReasoning's real control flow with the Anthropic SDK mocked.
const create = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({ __esModule: true, default: jest.fn().mockImplementation(() => ({ messages: { create } })) }));
import { callClaudeReasoning, buildSystemPrompt, buildUserPrompt, estimateTokens } from '../../src/services/claude';

const body = { themes: ['t'], insights: ['i'], quality_score: 7, next_steps: [], tensions: [], idea_score: 0.7, idea_hypothesis: 'IDEA: x' };
const sdkReply = (text: string, inTok = 100, outTok = 50) => ({ content: [{ type: 'text', text }], usage: { input_tokens: inTok, output_tokens: outTok } });
const req = { conversation_id: 'c1', messages: [{ avatar_id: 'a', content: 'hello', created_at: new Date() }] };

beforeEach(() => { create.mockReset(); jest.useFakeTimers({ advanceTimers: true }); });
afterEach(() => jest.useRealTimers());

test('prompt builders include idea_score/idea_hypothesis instructions and message history', () => {
  expect(buildSystemPrompt()).toMatch(/idea_score/); expect(buildSystemPrompt()).toMatch(/idea_hypothesis/);
  expect(buildUserPrompt(req.messages)).toContain('hello');
  expect(estimateTokens('abcdefgh')).toBe(2);
});

test('parses fenced JSON and computes cost from configurable rates', async () => {
  process.env.CLAUDE_COST_INPUT_PER_MTOK = '2'; process.env.CLAUDE_COST_OUTPUT_PER_MTOK = '10';
  create.mockResolvedValue(sdkReply('```json\n' + JSON.stringify(body) + '\n```', 1_000_000, 100_000));
  const r = await callClaudeReasoning(req);
  expect(r.response.idea_score).toBe(0.7);
  expect(r.tokensUsed).toBe(1_100_000);
  expect(r.cost).toBeCloseTo(2 + 1, 6);
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ model: process.env.CLAUDE_MODEL || 'claude-sonnet-5', max_tokens: 1024 }));
  delete process.env.CLAUDE_COST_INPUT_PER_MTOK; delete process.env.CLAUDE_COST_OUTPUT_PER_MTOK;
});

test('retries with backoff after a transient failure and then succeeds', async () => {
  create.mockRejectedValueOnce(Object.assign(new Error('overloaded'), { status: 529 }))
        .mockResolvedValueOnce(sdkReply(JSON.stringify(body)));
  const p = callClaudeReasoning(req, 3);
  await jest.advanceTimersByTimeAsync(1100);
  const r = await p;
  expect(create).toHaveBeenCalledTimes(2);
  expect(r.response.quality_score).toBe(7);
});

test('unparseable output is retried and the last error is thrown after maxAttempts', async () => {
  create.mockResolvedValue(sdkReply('sorry, no json here'));
  const p = callClaudeReasoning(req, 2).catch((e) => e);
  await jest.advanceTimersByTimeAsync(1100);
  const err = await p;
  expect(err).toBeInstanceOf(Error);
  expect(err.message).toMatch(/No JSON object/);
  expect(create).toHaveBeenCalledTimes(2);
});

test('response without a text block is an error', async () => {
  create.mockResolvedValue({ content: [{ type: 'tool_use' }], usage: { input_tokens: 1, output_tokens: 1 } });
  await expect(callClaudeReasoning(req, 1)).rejects.toThrow('No text response');
});
