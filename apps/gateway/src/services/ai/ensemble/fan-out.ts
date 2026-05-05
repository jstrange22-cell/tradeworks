/**
 * Multi-model parallel fan-out — primary primitive used by:
 *   - chat synthesis (apex-chat.ts)
 *   - TradeVisor ensemble reasoner (ensemble-reasoner.ts)
 *
 * Calls Claude / GPT-4o / Gemini / DeepSeek concurrently with a per-model
 * timeout. Each model is wrapped so it ALWAYS resolves with a ModelResponse —
 * a thrown error becomes `{ error, reply: '' }` so the caller can introspect
 * which models contributed.
 *
 * NOTE: This file is intentionally provider-agnostic at the type level.
 * Adapters live below as small functions that map our generic options onto
 * each vendor SDK / HTTP API.
 */
import { logger } from '../../../lib/logger.js';
import type { EnsembleModelName, FanOutOptions, FanOutResult, ModelResponse } from './types.js';

// ── Env keys (resolved lazily so tests can mock) ───────────────────────────
function envKey(name: string): string {
  return process.env[name] ?? '';
}

const DEFAULT_PER_MODEL_TIMEOUT_MS = 8_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_TOKENS = 800;
const DEFAULT_TEMPERATURE = 0.4;

const ALL_MODELS: ReadonlyArray<EnsembleModelName> = ['claude', 'gpt-4o', 'gemini', 'deepseek'];

type ImgMime = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
const ALLOWED_IMG_MIMES: ReadonlySet<string> = new Set<ImgMime>([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
]);

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Call all enabled models in parallel and return their responses. Always
 * resolves — failures are surfaced via `error` on individual responses.
 */
export async function callModelsParallel(opts: FanOutOptions): Promise<FanOutResult> {
  const start = Date.now();
  const perModelTimeoutMs = opts.perModelTimeoutMs ?? DEFAULT_PER_MODEL_TIMEOUT_MS;
  const totalTimeoutMs = opts.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
  const models = (opts.models ?? ALL_MODELS).filter(isEnabled);

  if (models.length === 0) {
    return { responses: [], anyOk: false, totalLatencyMs: Date.now() - start };
  }

  // Wrap every model in a watchdog so a stuck call can't block the others.
  const promises = models.map((m) => raceWithTimeout(callOne(m, opts), m, perModelTimeoutMs));

  // Hard total cap — if the slowest legitimate model exceeds totalTimeoutMs we
  // still let the in-flight ones report whatever they have, but bail-out is up
  // to the caller (typically: fail-closed).
  const all = Promise.all(promises);
  const totalRace = new Promise<ModelResponse[]>((resolve) => {
    const t = setTimeout(() => {
      logger.warn({ totalTimeoutMs, models }, '[ensemble] total wall-clock cap hit — returning partial responses');
      resolve(
        models.map((m) => ({
          model: m,
          reply: '',
          latencyMs: Date.now() - start,
          error: 'total-timeout',
        })),
      );
    }, totalTimeoutMs);
    all.then((rs) => { clearTimeout(t); resolve(rs); }).catch((err: unknown) => {
      clearTimeout(t);
      logger.warn({ err: err instanceof Error ? err.message : err }, '[ensemble] fan-out unexpected error');
      resolve(models.map((m) => ({ model: m, reply: '', latencyMs: Date.now() - start, error: 'unexpected' })));
    });
  });

  const responses = await totalRace;
  const totalLatencyMs = Date.now() - start;
  const anyOk = responses.some((r) => !r.error && r.reply.length > 0);
  return { responses, anyOk, totalLatencyMs };
}

/** True when the model is configured (API key present in env). */
export function isEnabled(model: EnsembleModelName): boolean {
  switch (model) {
    case 'claude': return Boolean(envKey('ANTHROPIC_API_KEY'));
    case 'gpt-4o': return Boolean(envKey('OPENAI_API_KEY'));
    case 'gemini': return Boolean(envKey('GEMINI_API_KEY'));
    case 'deepseek': return Boolean(envKey('DEEPSEEK_API_KEY'));
  }
}

// ── Internals ─────────────────────────────────────────────────────────────

async function raceWithTimeout(
  p: Promise<ModelResponse>,
  model: EnsembleModelName,
  timeoutMs: number,
): Promise<ModelResponse> {
  return new Promise<ModelResponse>((resolve) => {
    let done = false;
    const t = setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ model, reply: '', latencyMs: timeoutMs, error: `per-model-timeout(${timeoutMs}ms)` });
    }, timeoutMs);
    p.then((r) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve(r);
    }).catch((err: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve({
        model,
        reply: '',
        latencyMs: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });
}

async function callOne(model: EnsembleModelName, opts: FanOutOptions): Promise<ModelResponse> {
  switch (model) {
    case 'claude': return callClaude(opts);
    case 'gpt-4o': return callOpenAI(opts);
    case 'gemini': return callGemini(opts);
    case 'deepseek': return callDeepSeek(opts);
  }
}

// ── Claude (Anthropic SDK) ────────────────────────────────────────────────

async function callClaude(opts: FanOutOptions): Promise<ModelResponse> {
  const apiKey = envKey('ANTHROPIC_API_KEY');
  if (!apiKey) return { model: 'claude', reply: '', latencyMs: 0, error: 'no-api-key' };
  const start = Date.now();
  const modelId = process.env['APEX_ENSEMBLE_CLAUDE_MODEL']
    ?? process.env['TRADEVISOR_AGENT_MODEL']
    ?? 'claude-sonnet-4-6';
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey });
    const userContent: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; source: { type: 'base64'; media_type: ImgMime; data: string } }
    > = [];
    if (opts.imageBase64 && opts.imageMime && ALLOWED_IMG_MIMES.has(opts.imageMime)) {
      userContent.push({
        type: 'image',
        source: { type: 'base64', media_type: opts.imageMime as ImgMime, data: opts.imageBase64 },
      });
    }
    userContent.push({ type: 'text', text: opts.userPrompt });
    const resp = await client.messages.create({
      model: modelId,
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: opts.temperature ?? DEFAULT_TEMPERATURE,
      system: opts.systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    });
    const text = resp.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
    const usage = (resp as unknown as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
    const result: ModelResponse = { model: modelId, reply: text, latencyMs: Date.now() - start };
    if (typeof usage?.input_tokens === 'number') result.tokensIn = usage.input_tokens;
    if (typeof usage?.output_tokens === 'number') result.tokensOut = usage.output_tokens;
    return result;
  } catch (err) {
    return {
      model: modelId,
      reply: '',
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'failed',
    };
  }
}

// ── OpenAI GPT-4o ─────────────────────────────────────────────────────────

async function callOpenAI(opts: FanOutOptions): Promise<ModelResponse> {
  const apiKey = envKey('OPENAI_API_KEY');
  if (!apiKey) return { model: 'gpt-4o', reply: '', latencyMs: 0, error: 'no-api-key' };
  const start = Date.now();
  const modelId = process.env['APEX_ENSEMBLE_OPENAI_MODEL'] ?? 'gpt-4o';
  try {
    type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
    const userContent: ContentPart[] = [{ type: 'text', text: opts.userPrompt }];
    if (opts.imageBase64 && opts.imageMime) {
      userContent.unshift({
        type: 'image_url',
        image_url: { url: `data:${opts.imageMime};base64,${opts.imageBase64}` },
      });
    }
    const messages = [
      { role: 'system' as const, content: opts.systemPrompt },
      { role: 'user' as const, content: userContent },
    ];
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: modelId,
        messages,
        max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: opts.temperature ?? DEFAULT_TEMPERATURE,
      }),
      signal: AbortSignal.timeout((opts.perModelTimeoutMs ?? DEFAULT_PER_MODEL_TIMEOUT_MS) - 100),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { model: modelId, reply: '', latencyMs: Date.now() - start, error: `HTTP ${res.status}: ${body.slice(0, 120)}` };
    }
    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const result: ModelResponse = {
      model: modelId,
      reply: data.choices?.[0]?.message?.content ?? '',
      latencyMs: Date.now() - start,
    };
    if (typeof data.usage?.prompt_tokens === 'number') result.tokensIn = data.usage.prompt_tokens;
    if (typeof data.usage?.completion_tokens === 'number') result.tokensOut = data.usage.completion_tokens;
    return result;
  } catch (err) {
    return { model: modelId, reply: '', latencyMs: Date.now() - start, error: err instanceof Error ? err.message : 'failed' };
  }
}

// ── Gemini 2.5 Flash ──────────────────────────────────────────────────────

async function callGemini(opts: FanOutOptions): Promise<ModelResponse> {
  const apiKey = envKey('GEMINI_API_KEY');
  if (!apiKey) return { model: 'gemini', reply: '', latencyMs: 0, error: 'no-api-key' };
  const start = Date.now();
  const modelId = process.env['APEX_ENSEMBLE_GEMINI_MODEL'] ?? 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
  try {
    const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
      { text: opts.userPrompt },
    ];
    if (opts.imageBase64 && opts.imageMime) {
      parts.unshift({ inlineData: { mimeType: opts.imageMime, data: opts.imageBase64 } });
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: opts.systemPrompt }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: opts.temperature ?? DEFAULT_TEMPERATURE,
          maxOutputTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
          topP: 0.9,
        },
      }),
      signal: AbortSignal.timeout((opts.perModelTimeoutMs ?? DEFAULT_PER_MODEL_TIMEOUT_MS) - 100),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { model: modelId, reply: '', latencyMs: Date.now() - start, error: `HTTP ${res.status}: ${body.slice(0, 120)}` };
    }
    const data = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const reply = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    const result: ModelResponse = { model: modelId, reply, latencyMs: Date.now() - start };
    if (typeof data.usageMetadata?.promptTokenCount === 'number') result.tokensIn = data.usageMetadata.promptTokenCount;
    if (typeof data.usageMetadata?.candidatesTokenCount === 'number') result.tokensOut = data.usageMetadata.candidatesTokenCount;
    return result;
  } catch (err) {
    return { model: modelId, reply: '', latencyMs: Date.now() - start, error: err instanceof Error ? err.message : 'failed' };
  }
}

// ── DeepSeek (text-only) ──────────────────────────────────────────────────

async function callDeepSeek(opts: FanOutOptions): Promise<ModelResponse> {
  const apiKey = envKey('DEEPSEEK_API_KEY');
  if (!apiKey) return { model: 'deepseek', reply: '', latencyMs: 0, error: 'no-api-key' };
  const start = Date.now();
  const modelId = process.env['APEX_ENSEMBLE_DEEPSEEK_MODEL'] ?? 'deepseek-chat';
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: 'system', content: opts.systemPrompt },
          { role: 'user', content: opts.userPrompt },
        ],
        max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: opts.temperature ?? DEFAULT_TEMPERATURE,
      }),
      signal: AbortSignal.timeout((opts.perModelTimeoutMs ?? DEFAULT_PER_MODEL_TIMEOUT_MS) - 100),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { model: modelId, reply: '', latencyMs: Date.now() - start, error: `HTTP ${res.status}: ${body.slice(0, 120)}` };
    }
    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const result: ModelResponse = {
      model: modelId,
      reply: data.choices?.[0]?.message?.content ?? '',
      latencyMs: Date.now() - start,
    };
    if (typeof data.usage?.prompt_tokens === 'number') result.tokensIn = data.usage.prompt_tokens;
    if (typeof data.usage?.completion_tokens === 'number') result.tokensOut = data.usage.completion_tokens;
    return result;
  } catch (err) {
    return { model: modelId, reply: '', latencyMs: Date.now() - start, error: err instanceof Error ? err.message : 'failed' };
  }
}
