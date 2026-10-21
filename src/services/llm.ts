// Single provider-agnostic entry point for every model call in MOJOMO.
//
// Historically each service (claude.ts, avatarChat.ts, matchmaking.ts, profileSynthesis.ts)
// constructed its own Anthropic client. That made swapping providers a four-file edit and let
// the four call sites drift apart. Everything now goes through complete() below.
//
// Provider is chosen by LLM_PROVIDER (default 'deepseek'). DeepSeek exposes an
// OpenAI-compatible /chat/completions endpoint, so no extra SDK is needed - plain fetch.
//
//   LLM_PROVIDER=deepseek  DEEPSEEK_API_KEY=...  DEEPSEEK_MODEL=deepseek-chat
//   LLM_PROVIDER=anthropic CLAUDE_API_KEY=...    CLAUDE_MODEL=claude-haiku-4-5-20251001

export type LlmProvider = 'deepseek' | 'anthropic';

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens: number;
  /** Ask the provider for a JSON object response where supported. */
  json?: boolean;
}

export interface LlmResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  provider: LlmProvider;
}

export function llmProvider(): LlmProvider {
  const p = (process.env.LLM_PROVIDER || 'deepseek').toLowerCase();
  return p === 'anthropic' ? 'anthropic' : 'deepseek';
}

export function llmModel(): string {
  if (llmProvider() === 'anthropic') return process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';
  return process.env.DEEPSEEK_MODEL || 'deepseek-chat';
}

function requireKey(provider: LlmProvider): string {
  const key = provider === 'anthropic' ? process.env.CLAUDE_API_KEY : process.env.DEEPSEEK_API_KEY;
  if (!key) {
    throw new Error(
      provider === 'anthropic'
        ? 'CLAUDE_API_KEY is not set (LLM_PROVIDER=anthropic)'
        : 'DEEPSEEK_API_KEY is not set (LLM_PROVIDER=deepseek)'
    );
  }
  return key;
}

/** Per-million-token rates used for the cost column; override via env. */
export function costRates(): { input: number; output: number } {
  if (llmProvider() === 'anthropic') {
    return {
      input: Number(process.env.CLAUDE_COST_INPUT_PER_MTOK || 3),
      output: Number(process.env.CLAUDE_COST_OUTPUT_PER_MTOK || 15),
    };
  }
  return {
    input: Number(process.env.DEEPSEEK_COST_INPUT_PER_MTOK || 0.28),
    output: Number(process.env.DEEPSEEK_COST_OUTPUT_PER_MTOK || 0.42),
  };
}

export function estimateCost(inputTokens: number, outputTokens: number): number {
  const r = costRates();
  return (inputTokens / 1_000_000) * r.input + (outputTokens / 1_000_000) * r.output;
}

const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 60_000);

async function callDeepSeek(req: LlmRequest): Promise<LlmResponse> {
  const key = requireKey('deepseek');
  const base = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
  const model = llmModel();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        max_tokens: req.maxTokens,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        ...(req.json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`DeepSeek ${res.status}: ${body.slice(0, 500)}`);
    }

    const data: any = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new Error('No text response from DeepSeek');

    return {
      text: text.trim(),
      inputTokens: data?.usage?.prompt_tokens ?? 0,
      outputTokens: data?.usage?.completion_tokens ?? 0,
      model,
      provider: 'deepseek',
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callAnthropic(req: LlmRequest): Promise<LlmResponse> {
  const key = requireKey('anthropic');
  const model = llmModel();
  const base = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Anthropic ${res.status}: ${body.slice(0, 500)}`);
    }

    const data: any = await res.json();
    const block = (data?.content || []).find((b: any) => b.type === 'text');
    if (!block || typeof block.text !== 'string' || !block.text.trim()) throw new Error('No text response from Anthropic');

    return {
      text: block.text.trim(),
      inputTokens: data?.usage?.input_tokens ?? 0,
      outputTokens: data?.usage?.output_tokens ?? 0,
      model,
      provider: 'anthropic',
    };
  } finally {
    clearTimeout(timer);
  }
}

/** One model call. Retries transient failures with exponential backoff. */
export async function complete(req: LlmRequest, maxAttempts = 3): Promise<LlmResponse> {
  const provider = llmProvider();
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return provider === 'anthropic' ? await callAnthropic(req) : await callDeepSeek(req);
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt - 1) * 1000));
      }
    }
  }

  throw lastError || new Error('LLM call failed');
}

export default { complete, llmProvider, llmModel, estimateCost, costRates };
