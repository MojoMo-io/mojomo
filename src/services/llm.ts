// Single entry point for every model call in MOJOMO.
//
// DeepSeek is the only provider. It exposes an OpenAI-compatible
// /chat/completions endpoint, so no SDK is needed - plain fetch.
//
//   DEEPSEEK_API_KEY=...  DEEPSEEK_MODEL=deepseek-chat
//
// A retired provider path was removed rather than left dormant: a disabled
// fallback is one env edit away from spending money on a provider we do not
// use. If a second provider is ever wanted, add it here deliberately, with
// its own tests.

export type LlmProvider = 'deepseek';

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
  return 'deepseek';
}

export function llmModel(): string {
  return process.env.DEEPSEEK_MODEL || 'deepseek-chat';
}

function requireKey(): string {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error('DEEPSEEK_API_KEY is not set');
  return key;
}

/** Per-million-token rates used for the cost column; override via env. */
export function costRates(): { input: number; output: number } {
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
  const key = requireKey();
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
      // Provider error bodies echo the key suffix back. Scrub before this
      // string can reach a log, an API response, or a chat message.
      throw new Error(`DeepSeek ${res.status}: ${scrubSecrets(body.slice(0, 500))}`);
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

/** One model call. Retries transient failures with exponential backoff. */
const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{8,}/g,
  /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/g,
  /\bmjm_[A-Za-z0-9_-]{8,}\b/g,
  /(api[_-]?key\"?\s*[:=]\s*\"?)[^\s",}]+/gi,
];

/** Strip anything credential-shaped before an error string leaves the process. */
export function scrubSecrets(text: string): string {
  let out = String(text);
  for (const pat of SECRET_PATTERNS) {
    // Patterns with a capture group keep the label and redact only the value.
    out = out.replace(pat, (m, g1) => (g1 ? `${g1}<redacted>` : '<redacted>'));
  }
  return out;
}

export async function complete(req: LlmRequest, maxAttempts = 3): Promise<LlmResponse> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await callDeepSeek(req);
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
