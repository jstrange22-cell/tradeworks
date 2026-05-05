/**
 * Shared ensemble types — used by both chat synthesis and TradeVisor reasoner.
 */

export type EnsembleModelName = 'claude' | 'gpt-4o' | 'gemini' | 'deepseek';

export interface ModelResponse {
  model: EnsembleModelName | string;
  reply: string;
  latencyMs: number;
  /** Approximate token counts for cost tracking. Null when unknown. */
  tokensIn?: number;
  tokensOut?: number;
  error?: string;
}

export interface FanOutOptions {
  systemPrompt: string;
  userPrompt: string;
  /** Per-model timeout (ms). Default 8000. */
  perModelTimeoutMs?: number;
  /** Hard cap on the wall-clock duration of the full fan-out. Default 12000. */
  totalTimeoutMs?: number;
  /** Optional image to pass to vision-capable models (Claude + GPT-4o). */
  imageBase64?: string;
  imageMime?: string;
  /** Override max_tokens — defaults to 800 (reasoner) or 3000 (chat-style). */
  maxTokens?: number;
  /** Sampling temperature. Default 0.4 — lower for trade decisions, higher for chat. */
  temperature?: number;
  /** Subset of models to call. Default all 4. */
  models?: ReadonlyArray<EnsembleModelName>;
}

export interface FanOutResult {
  responses: ModelResponse[];
  /** True when at least one model returned a usable reply. */
  anyOk: boolean;
  /** Total wall-clock for the fan-out. */
  totalLatencyMs: number;
}
