import { complete, estimateCost } from './llm';

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
    throw new Error('No JSON object in model response');
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
      // Transport-level retries live in llm.complete(); this loop retries *unparseable* output,
      // which is a model-quality problem rather than a network one.
      const result = await complete(
        { system: systemPrompt, user: userPrompt, maxTokens: 1024, json: true },
        1
      );
      const response: ReasoningResponse = parseReasoningJson(result.text);
      const cost = estimateCost(result.inputTokens, result.outputTokens);
      return { response, tokensUsed: result.inputTokens + result.outputTokens, cost };
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt - 1) * 1000));
      }
    }
  }

  throw lastError || new Error('Failed to get reasoning response');
}

export function estimateTokens(prompt: string): number {
  return Math.ceil(prompt.length / 4);
}
