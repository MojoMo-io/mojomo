import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

export interface ReasoningRequest {
  conversation_id: string;
  messages: Array<{ avatar_id: string; content: string; created_at: Date }>;
  prompt_override?: string;
}

export interface ReasoningResponse {
  themes: string[];
  insights: string[];
  quality_score: number;
  next_steps: string[];
  tensions: string[];
  /** 0.0-1.0: how strongly this exchange contains a novel, actionable idea (spec threshold 0.65) */
  idea_score?: number;
  /** Self-contained statement of the idea, beginning with "IDEA:", when idea_score >= 0.65 */
  idea_hypothesis?: string;
}

export function buildSystemPrompt(): string {
  return `You are analyzing conversations between avatars collaborating on ideas.
Identify themes, extract insights, score quality (0-10), suggest next steps, and flag tensions.
Also include these two fields:
- "idea_score": a number from 0.0 to 1.0 rating how strongly this exchange contains a novel, concrete, actionable idea worth recording (0.65 or higher means yes).
- "idea_hypothesis": if idea_score is 0.65 or higher, one self-contained paragraph stating the idea, beginning with the exact prefix "IDEA:"; otherwise an empty string.

Respond in valid JSON only with no additional text.`;
}

export function buildUserPrompt(
  messages: Array<{ avatar_id: string; content: string; created_at: Date }>,
  customPrompt?: string
): string {
  const messageContext = messages
    .slice(-10)
    .map((msg) => `[${msg.avatar_id}]: ${msg.content}`)
    .join('\n');

  const basePrompt = `Analyze:\n\n${messageContext}`;
  return customPrompt ? `${basePrompt}\n\n${customPrompt}` : basePrompt;
}

/**
 * Tolerant JSON extraction: models often wrap output in ```json fences or add a
 * leading sentence despite "JSON only" instructions. Take the outermost {...}.
 */
export function parseReasoningJson(text: string): ReasoningResponse {
  let t = text.trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object in Claude response');
  }
  return JSON.parse(t.slice(start, end + 1)) as ReasoningResponse;
}

export async function callClaudeReasoning(
  request: ReasoningRequest,
  maxAttempts: number = 3
): Promise<{ response: ReasoningResponse; tokensUsed: number; cost: number }> {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(request.messages, request.prompt_override);

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const message = await client.messages.create({
        model: process.env.CLAUDE_MODEL || 'claude-sonnet-5',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const textContent = message.content.find((block) => block.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        throw new Error('No text response');
      }

      const responseText = textContent.text.trim();
      const response: ReasoningResponse = parseReasoningJson(responseText);

      const inputTokens = message.usage.input_tokens;
      const outputTokens = message.usage.output_tokens;
      const inRate = Number(process.env.CLAUDE_COST_INPUT_PER_MTOK || 3);
      const outRate = Number(process.env.CLAUDE_COST_OUTPUT_PER_MTOK || 15);
      const cost = (inputTokens / 1_000_000) * inRate + (outputTokens / 1_000_000) * outRate;

      return { response, tokensUsed: inputTokens + outputTokens, cost };
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt - 1) * 1000));
      }
    }
  }

  throw lastError || new Error('Failed to get Claude reasoning');
}

export function estimateTokens(prompt: string): number {
  return Math.ceil(prompt.length / 4);
}
