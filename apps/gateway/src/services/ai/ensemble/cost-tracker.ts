/**
 * Daily AI spend tracker — enforces TRADEVISOR_DAILY_AI_BUDGET_USD.
 *
 * Rough cost model uses public Anthropic / OpenAI / Google / DeepSeek pricing
 * snapshots (March 2026). When real usage data isn't available we fall back
 * to a flat per-call estimate. The goal is "good enough" for a daily budget
 * cap, not invoice-grade accuracy.
 *
 * Persists to data/ai-spend.json (configurable via TRADEVISOR_AI_SPEND_FILE).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { logger } from '../../../lib/logger.js';
import type { ModelResponse } from './types.js';

const SPEND_FILE = resolve(
  process.env['TRADEVISOR_AI_SPEND_FILE'] ?? './data/ai-spend.json',
);

const DEFAULT_DAILY_BUDGET_USD = 20;

interface SpendRecord {
  /** ISO date YYYY-MM-DD (UTC). */
  date: string;
  totalUsd: number;
  callCount: number;
  byModel: Record<string, { calls: number; usd: number }>;
}

interface SpendFile {
  current: SpendRecord;
  history: SpendRecord[]; // last 30 days
}

// Per-million-token pricing (USD). Approximate, March 2026.
// Source: vendor pricing pages — kept rough; recalibrate quarterly.
const PRICING: Record<string, { in: number; out: number; flatPerCall: number }> = {
  // Claude Sonnet ~$3 in / $15 out per 1M tokens
  'claude-sonnet-4-6': { in: 3.00, out: 15.00, flatPerCall: 0.025 },
  'claude-opus-4-7': { in: 15.00, out: 75.00, flatPerCall: 0.10 },
  // OpenAI GPT-4o ~$2.50 in / $10 out
  'gpt-4o': { in: 2.50, out: 10.00, flatPerCall: 0.020 },
  // Gemini 2.5 Flash ~$0.075 in / $0.30 out (still very cheap)
  'gemini-2.5-flash': { in: 0.075, out: 0.30, flatPerCall: 0.001 },
  // DeepSeek ~$0.27 in / $1.10 out
  'deepseek-chat': { in: 0.27, out: 1.10, flatPerCall: 0.005 },
};

const FALLBACK_PRICING = { in: 1.0, out: 5.0, flatPerCall: 0.015 };

// ── Cost estimation ───────────────────────────────────────────────────────

export function estimateCallCostUsd(r: ModelResponse): number {
  const pricing = PRICING[r.model] ?? PRICING[normaliseModel(r.model)] ?? FALLBACK_PRICING;
  if (typeof r.tokensIn === 'number' && typeof r.tokensOut === 'number') {
    return (r.tokensIn / 1_000_000) * pricing.in + (r.tokensOut / 1_000_000) * pricing.out;
  }
  return pricing.flatPerCall;
}

function normaliseModel(m: string): string {
  if (m.startsWith('claude-sonnet')) return 'claude-sonnet-4-6';
  if (m.startsWith('claude-opus')) return 'claude-opus-4-7';
  if (m.startsWith('gpt-4o')) return 'gpt-4o';
  if (m.startsWith('gemini')) return 'gemini-2.5-flash';
  if (m.startsWith('deepseek')) return 'deepseek-chat';
  return m;
}

// ── Persistence ───────────────────────────────────────────────────────────

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function loadSpend(): SpendFile {
  if (!existsSync(SPEND_FILE)) {
    return { current: emptyRecord(todayUtc()), history: [] };
  }
  try {
    const raw = readFileSync(SPEND_FILE, 'utf8');
    const parsed = JSON.parse(raw) as SpendFile;
    if (parsed.current?.date !== todayUtc()) {
      // Roll over — push the old "current" into history, start a new day.
      const newHistory = [parsed.current, ...(parsed.history ?? [])].slice(0, 30);
      return { current: emptyRecord(todayUtc()), history: newHistory };
    }
    return parsed;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[ensemble.cost] spend file unreadable — resetting');
    return { current: emptyRecord(todayUtc()), history: [] };
  }
}

function saveSpend(s: SpendFile): void {
  try {
    mkdirSync(dirname(SPEND_FILE), { recursive: true });
    writeFileSync(SPEND_FILE, JSON.stringify(s, null, 2));
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[ensemble.cost] spend persist failed');
  }
}

function emptyRecord(date: string): SpendRecord {
  return { date, totalUsd: 0, callCount: 0, byModel: {} };
}

// ── Public API ────────────────────────────────────────────────────────────

/** Returns the configured daily budget. */
export function getDailyBudgetUsd(): number {
  const v = Number(process.env['TRADEVISOR_DAILY_AI_BUDGET_USD']);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_DAILY_BUDGET_USD;
}

/** Current spend for today (UTC). */
export function getDailySpend(): SpendRecord {
  return loadSpend().current;
}

/** True when today's spend has met-or-exceeded the budget. */
export function isOverBudget(): boolean {
  const spend = getDailySpend();
  const budget = getDailyBudgetUsd();
  return spend.totalUsd >= budget;
}

/**
 * Record an array of model responses against today's spend.
 * Failed responses (with error set) are tallied as $0 — vendors usually
 * don't bill failed calls.
 */
export function recordEnsembleSpend(responses: ReadonlyArray<ModelResponse>): {
  added: number;
  total: number;
  budget: number;
  overBudget: boolean;
} {
  const file = loadSpend();
  let added = 0;
  for (const r of responses) {
    if (r.error || r.reply.length === 0) continue;
    const cost = estimateCallCostUsd(r);
    added += cost;
    file.current.totalUsd += cost;
    file.current.callCount += 1;
    const key = normaliseModel(r.model);
    const bucket = file.current.byModel[key] ?? { calls: 0, usd: 0 };
    bucket.calls += 1;
    bucket.usd += cost;
    file.current.byModel[key] = bucket;
  }
  if (added > 0) saveSpend(file);
  const budget = getDailyBudgetUsd();
  const overBudget = file.current.totalUsd >= budget;
  if (overBudget) {
    logger.warn(
      { spend: file.current.totalUsd.toFixed(4), budget, addedUsd: added.toFixed(4) },
      '[ensemble.cost] daily AI budget breached — ensemble will fall back to solo until tomorrow',
    );
  }
  return { added, total: file.current.totalUsd, budget, overBudget };
}

/** Test-only: reset the in-memory + on-disk spend tracker for today. */
export function resetSpendForTesting(): void {
  saveSpend({ current: emptyRecord(todayUtc()), history: [] });
}
