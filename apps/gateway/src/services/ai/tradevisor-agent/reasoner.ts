/**
 * TradeVisor reasoner — wraps Claude with structured JSON output.
 *
 * Takes a fully-gathered SignalContext, builds a tight prompt, and asks
 * Claude (via @anthropic-ai/sdk) for a binary verdict + reasoning + adjusted
 * sizing/stop. Uses the JSON-mode pattern where Claude is instructed to
 * return ONLY a JSON object — we strip markdown fences and parse defensively.
 *
 * The system prompt is loaded from openclaw-finance/SOUL.md (same source as
 * apex-chat) so the reasoner inherits the full APEX identity, security
 * rules, regulatory compliance, and escalation matrix. This means the
 * reasoner already KNOWS to escalate trades >$50K, refuse to bypass
 * circuit breakers, etc.
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../../../lib/logger.js';
import type { SignalContext, Decision, DecisionVerdict } from './types.js';
import { randomUUID } from 'crypto';
import { retrieveSimilarTrades } from '../../memory/rag.js';
import { formatRagContext } from '../../memory/rag-format.js';
import { isAvailable as isMemoryAvailable } from '../../memory/db.js';
import { renderActiveForPrompt } from '../post-mortem/heuristics-store.js';

// ── Load SOUL.md once at module init ────────────────────────────────────
let SOUL_PROMPT = '';
const candidatePaths = [
  resolve(process.cwd(), 'openclaw-finance/SOUL.md'),
  resolve(process.cwd(), '../../openclaw-finance/SOUL.md'),
  '/opt/tradeworks/openclaw-finance/SOUL.md',
];
for (const p of candidatePaths) {
  try {
    SOUL_PROMPT = readFileSync(p, 'utf-8');
    break;
  } catch { /* try next */ }
}
if (!SOUL_PROMPT) {
  SOUL_PROMPT = 'You are APEX, the trading intelligence agent for TradeWorks built by Strange Digital Group. Be precise, quantitative, and risk-aware.';
}

// ── Load calibration summary at module init (READ-ONLY injection) ─────
// The nightly calibration job writes apps/gateway/data/calibration-summary.md.
// We surface it to the reasoner as a top-of-prompt block so it can
// self-correct (e.g. avoid over-confident sizes, skip volatile regime
// approves with no Scout corroboration, etc.). Stale beyond 7 days → skip.
const CALIBRATION_MAX_AGE_DAYS = 7;
let CALIBRATION_CONTEXT: string | null = null;

function loadCalibrationContext(): string | null {
  // Walk up from src/services/ai/tradevisor-agent/ to apps/gateway/
  const here = dirname(fileURLToPath(import.meta.url));
  const tvAgent = here;                                  // .../tradevisor-agent
  const aiDir = dirname(tvAgent);                        // .../ai
  const services = dirname(aiDir);                       // .../services
  const srcOrDist = dirname(services);                   // .../src or .../dist
  const gatewayRoot = dirname(srcOrDist);                // .../apps/gateway
  const summaryPath = resolve(gatewayRoot, 'data', 'calibration-summary.md');

  try {
    const stat = statSync(summaryPath);
    const ageDays = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24);
    if (ageDays > CALIBRATION_MAX_AGE_DAYS) {
      logger.warn(
        { summaryPath, ageDays: ageDays.toFixed(1) },
        '[TVAgent] calibration summary stale (> 7 days) — skipping injection',
      );
      return null;
    }
    const content = readFileSync(summaryPath, 'utf-8').trim();
    if (!content) return null;
    logger.info(
      { summaryPath, ageDays: ageDays.toFixed(2), bytes: Buffer.byteLength(content, 'utf-8') },
      '[TVAgent] calibration summary loaded',
    );
    return content;
  } catch {
    // No calibration file yet — first run, normal.
    return null;
  }
}
CALIBRATION_CONTEXT = loadCalibrationContext();

// ── Load active learned heuristics at module init ───────────────────────
// Heuristics are extracted nightly by the post-mortem loop, reviewed and
// approved via /api/v1/post-mortem/approve, then stored in
// openclaw-finance/learned_heuristics.md. We inject only the Active list
// (not Pending or Rejected). Empty string when no active heuristics yet.
let LEARNED_HEURISTICS: string = '';
try {
  LEARNED_HEURISTICS = renderActiveForPrompt();
  if (LEARNED_HEURISTICS) {
    logger.info(
      { bytes: Buffer.byteLength(LEARNED_HEURISTICS, 'utf-8') },
      '[TVAgent] learned heuristics loaded',
    );
  }
} catch (err) {
  logger.warn(
    { err: err instanceof Error ? err.message : err },
    '[TVAgent] learned heuristics load failed — continuing without them',
  );
  LEARNED_HEURISTICS = '';
}

// ── Reasoner-specific instructions (appended to SOUL) ──────────────────
const REASONER_INSTRUCTIONS = `

## YOUR ROLE IN THIS REQUEST
You are evaluating a single TradeVisor signal that just fired. The signal source is the user's paid TradeVisor V2 Pine indicator running on their TradingView chart, surfaced via the APEX Webhook Bridge.

Your job is binary: should the bot ACT on this signal (with what size and stop), or should it SKIP it, or should it ESCALATE to a human?

## DECISION CRITERIA (all must align for APPROVE)
1. **Portfolio room**: position count below cap, sector cap not breached, target symbol not already held (sells are exempt from "already held").
2. **Daily P&L room**: not within 0.5% of the daily loss limit.
3. **News sanity**: no breaking negative catalyst in the last 24h that contradicts the signal direction (e.g. SEC investigation announced 1h ago + BUY signal = VETO unless extraordinary upside).
4. **Macro alignment**: in 'risk-off' or 'crisis' regime, BUY signals require Scout rank in top 10 OR atrExpansion > 1.5x to APPROVE — otherwise VETO. SELL signals get extra weight in those regimes.
5. **Scout corroboration**: if the ticker is on the watchlist, prefer it. If it's NOT on the watchlist (came in via webhook only), require BOTH chart confluence AND clean news to APPROVE.

## ESCALATE (don't auto-act) when
- Stake size would exceed $5,000 OR 5% of portfolio (per SOUL.md escalation matrix)
- Macro regime is 'crisis'
- News contains regulatory action against the issuer (lawsuit, FDA rejection, fraud accusation)
- Signal contradicts an existing position (e.g. BUY signal on a ticker we just opened a SHORT/PUT on)
- Stop placement is unclear (no obvious chart structure to anchor it to)

## SIZING LADDER (default — adjust ±50% based on conviction)
- standard score=4 → $100 base
- strong score=5 → $250 base
- prime score=6 → $500 base

You MAY recommend SIZE = 0 alongside VETO to make the rejection unambiguous.

## OUTPUT FORMAT
Respond with ONLY a single JSON object, no prose, no markdown fences:
{
  "verdict": "approve" | "veto" | "escalate",
  "reasoning": "2-4 sentence explanation citing specific context fields",
  "confidence": 0.0..1.0,
  "adjustedSizeUsd": null | number,
  "adjustedStopPct": -3.0..-10.0
}

If verdict is "veto" or "escalate", adjustedSizeUsd should typically be null and adjustedStopPct doesn't matter.
`;

const FULL_SYSTEM_PROMPT = SOUL_PROMPT + REASONER_INSTRUCTIONS;

// ── Build the per-signal user prompt ────────────────────────────────────
function buildUserPrompt(ctx: SignalContext): string {
  const s = ctx.signal;
  const lines: string[] = [];
  if (CALIBRATION_CONTEXT) {
    // READ-ONLY injection of nightly calibration stats. The reasoner uses these
    // for self-correction but does not modify them.
    lines.push('## HISTORICAL CALIBRATION (read-only — derived from your past approvals + outcomes)');
    lines.push(CALIBRATION_CONTEXT);
    lines.push('');
    lines.push('---');
    lines.push('');
  }
  if (LEARNED_HEURISTICS) {
    // Active heuristics extracted from prior losing-trade clusters (post-mortem).
    // These are the agent's own playbook — apply them on top of SOUL.md rules.
    lines.push(LEARNED_HEURISTICS);
    lines.push('');
    lines.push('---');
    lines.push('');
  }
  lines.push(`SIGNAL: ${s.action.toUpperCase()} ${s.symbol} @ $${s.price} (${s.assetClass})`);
  lines.push(`Source: ${s.sourceLabel ?? 'webhook'}, grade=${s.grade} (score=${s.score}), tf=${s.timeframe}, exchange=${s.exchange}`);

  lines.push('\nPORTFOLIO:');
  lines.push(`  cash: $${ctx.portfolio.cashUsd.toFixed(2)}, positions: ${ctx.portfolio.totalPositions}/${ctx.portfolio.maxPositions}`);
  lines.push(`  already-holding-${s.symbol}: ${ctx.portfolio.alreadyHolding ? 'YES' : 'no'}`);
  if (ctx.portfolio.equityPositions.length > 0) {
    const top = ctx.portfolio.equityPositions
      .slice(0, 8)
      .map((p) => `${p.symbol}(${p.sector},${p.unrealizedPnl >= 0 ? '+' : ''}$${p.unrealizedPnl.toFixed(0)})`)
      .join(', ');
    lines.push(`  open: ${top}`);
  }
  const sectorOfSymbol = ctx.portfolio.equityPositions.find((p) => p.symbol === s.symbol)?.sector
    ?? 'unknown';
  const sectorCount = ctx.portfolio.sectorCount[sectorOfSymbol] ?? 0;
  lines.push(`  sector(${sectorOfSymbol}) count: ${sectorCount}/${ctx.portfolio.sectorCap}`);

  lines.push('\nDAILY P&L:');
  lines.push(`  today realized: ${ctx.dailyPnl.pct >= 0 ? '+' : ''}${ctx.dailyPnl.pct.toFixed(2)}% (limit ${ctx.dailyPnl.limitPct}%, remaining headroom ${ctx.dailyPnl.remaining.toFixed(2)}%)`);

  lines.push('\nMACRO REGIME:');
  lines.push(`  ${ctx.macro.regime} — SPY rs5d=${(ctx.macro.spyRs5d * 100).toFixed(1)}% rs20d=${(ctx.macro.spyRs20d * 100).toFixed(1)}% (${ctx.macro.notes})`);

  lines.push('\nSCOUT WATCHLIST:');
  if (ctx.scout) {
    lines.push(`  rank #${ctx.scout.rank}/${ctx.scout.totalStocks} (${ctx.scout.refreshSource})`);
    lines.push(`  rs5d=${(ctx.scout.rs5d * 100).toFixed(1)}% rs20d=${(ctx.scout.rs20d * 100).toFixed(1)}% atrExp=${ctx.scout.atrExpansion.toFixed(2)}x`);
    if (ctx.scout.rationale) lines.push(`  Claude's pick rationale: ${ctx.scout.rationale.slice(0, 300)}`);
  } else {
    lines.push(`  ${s.symbol} NOT on the AI watchlist — webhook-driven signal only`);
  }

  lines.push('\nNEWS (last 24h):');
  if (ctx.news.length === 0) {
    lines.push('  no headlines in window');
  } else {
    for (const n of ctx.news.slice(0, 5)) {
      const ageStr = n.ageHours < 1 ? `${(n.ageHours * 60).toFixed(0)}m ago` : `${n.ageHours.toFixed(1)}h ago`;
      lines.push(`  [${ageStr} ${n.source}] ${n.headline}`);
    }
  }

  lines.push('\nCHART STATE:');
  if (ctx.chart) {
    lines.push(`  ${ctx.chart.matchedSymbol} on ${ctx.chart.resolution}`);
    if (Object.keys(ctx.chart.studyValues).length > 0) {
      lines.push(`  studies: ${JSON.stringify(ctx.chart.studyValues)}`);
    }
    if (ctx.chart.pineLines.length > 0) {
      lines.push(`  key levels: ${ctx.chart.pineLines.slice(0, 6).map((l) => `$${l.toFixed(2)}`).join(', ')}`);
    }
  } else {
    lines.push('  (chart MCP not available — bridge passed price + grade only)');
  }

  lines.push('\nDECIDE NOW. Return only the JSON object.');
  return lines.join('\n');
}

// ── Parse Claude's JSON output defensively ──────────────────────────────
function parseDecision(raw: string): { verdict: DecisionVerdict; reasoning: string; confidence: number; adjustedSizeUsd: number | null; adjustedStopPct: number } | null {
  const cleaned = raw.trim().replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    const verdict = obj['verdict'];
    if (verdict !== 'approve' && verdict !== 'veto' && verdict !== 'escalate') return null;
    const reasoning = typeof obj['reasoning'] === 'string' ? obj['reasoning'] : '';
    const confidence = typeof obj['confidence'] === 'number' ? Math.max(0, Math.min(1, obj['confidence'])) : 0.5;
    const adjustedSizeUsd =
      obj['adjustedSizeUsd'] === null || obj['adjustedSizeUsd'] === undefined
        ? null
        : typeof obj['adjustedSizeUsd'] === 'number'
          ? obj['adjustedSizeUsd']
          : null;
    const stopRaw = obj['adjustedStopPct'];
    const adjustedStopPct = typeof stopRaw === 'number'
      ? Math.max(-10, Math.min(-1, stopRaw))
      : -5;
    return { verdict, reasoning, confidence, adjustedSizeUsd, adjustedStopPct };
  } catch {
    return null;
  }
}

// ── RAG (similar past trades) prompt augmentation ──────────────────────
//
// `RAG_ENABLED` flag:
//   - 'true'  → always try retrieval (still graceful on failure).
//   - 'false' → never retrieve.
//   - unset   → auto-detect via memory DB health probe (cached).
//
// Resolved lazily so tests / env edits take effect at first call.
type RagState = 'on' | 'off' | 'auto';
function ragSetting(): RagState {
  const raw = (process.env['RAG_ENABLED'] ?? 'auto').toLowerCase();
  if (raw === 'true' || raw === '1' || raw === 'on') return 'on';
  if (raw === 'false' || raw === '0' || raw === 'off') return 'off';
  return 'auto';
}

let ragAutoCachedAt = 0;
let ragAutoEnabled = false;
const RAG_AUTO_TTL_MS = 60_000;
async function isRagEnabled(): Promise<boolean> {
  const setting = ragSetting();
  if (setting === 'off') return false;
  if (setting === 'on') return true;
  const now = Date.now();
  if (now - ragAutoCachedAt < RAG_AUTO_TTL_MS) return ragAutoEnabled;
  ragAutoEnabled = await isMemoryAvailable().catch(() => false);
  ragAutoCachedAt = now;
  return ragAutoEnabled;
}

/**
 * Build a compact embedding query string from the signal context. Kept short
 * so the embedding captures the trade's *shape* (symbol/action/strategy/regime)
 * rather than free-form prose.
 */
function buildRagQueryText(ctx: SignalContext): string {
  const s = ctx.signal;
  const parts: string[] = [
    `${s.action} ${s.symbol}`,
    `grade=${s.grade}`,
    `score=${s.score}`,
    `tf=${s.timeframe}`,
    `regime=${ctx.macro.regime}`,
  ];
  if (ctx.scout?.rationale) {
    parts.push(`scout: ${ctx.scout.rationale.slice(0, 200)}`);
  }
  return parts.join(' | ');
}

async function maybeBuildRagBlock(ctx: SignalContext): Promise<string | null> {
  try {
    if (!(await isRagEnabled())) return null;
    const queryText = buildRagQueryText(ctx);
    const trades = await retrieveSimilarTrades(queryText, {
      k: 10,
      minSimilarity: 0.5,
      onlyClosed: true,
    });
    if (trades.length === 0) return null;
    return formatRagContext(trades);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      '[TVAgent] RAG retrieval failed — proceeding without similar-trade context',
    );
    return null;
  }
}

// ── Public entry: reason about a signal, return a Decision ──────────────
const MODEL = process.env['TRADEVISOR_AGENT_MODEL'] ?? 'claude-sonnet-4-6';

// Fail mode: 'closed' (default, safe) vetoes when the reasoner can't run.
// 'open' is the legacy escape hatch that auto-approves on failure.
// Override via env: TRADEVISOR_FAIL_MODE=open
const FAIL_MODE: 'open' | 'closed' =
  process.env['TRADEVISOR_FAIL_MODE'] === 'open' ? 'open' : 'closed';

// Rolling 10-minute window of failure timestamps. If we see >5 failures in
// the window, log an error indicating manual intervention is required.
const FAILURE_WINDOW_MS = 10 * 60 * 1000;
const FAILURE_THRESHOLD = 5;
const failureTimestamps: number[] = [];

function recordFailure(reasonTag: string): void {
  const now = Date.now();
  // Drop entries older than the window
  while (failureTimestamps.length > 0 && now - (failureTimestamps[0] as number) > FAILURE_WINDOW_MS) {
    failureTimestamps.shift();
  }
  failureTimestamps.push(now);
  if (failureTimestamps.length > FAILURE_THRESHOLD) {
    logger.error(
      { failureCount: failureTimestamps.length, windowMs: FAILURE_WINDOW_MS, reasonTag },
      '[TVAgent] failure rate exceeded threshold — manual intervention required',
    );
  }
}

function failClosedReasoning(why: string): { reasoning: string; confidence: number; adjustedSize: number } {
  return {
    reasoning: `VETO (fail-closed): ${why}. Configure ANTHROPIC_API_KEY and verify the reasoner, or set TRADEVISOR_FAIL_MODE=open to override.`,
    confidence: 0.0,
    adjustedSize: 0,
  };
}

export async function reasonAboutSignal(ctx: SignalContext): Promise<Decision> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  const startedAt = Date.now();
  const id = randomUUID();
  const baseDecision: Omit<Decision, 'verdict' | 'reasoning' | 'confidence' | 'adjustedSize' | 'adjustedStopPct' | 'modelUsed' | 'reasoningLatencyMs'> = {
    id,
    signal: ctx.signal,
    context: ctx,
    createdAt: new Date().toISOString(),
  };

  // No API key → fail CLOSED by default (veto). Set TRADEVISOR_FAIL_MODE=open
  // to restore the legacy auto-approve behavior.
  if (!apiKey) {
    if (FAIL_MODE === 'open') {
      logger.warn('[TVAgent] ANTHROPIC_API_KEY not set — failing OPEN (auto-approve, legacy override)');
      recordFailure('no-api-key');
      return {
        ...baseDecision,
        verdict: 'approve',
        reasoning: 'Reasoner skipped — no Anthropic API key configured. Defaulted to APPROVE per fail-open policy.',
        confidence: 0.5,
        adjustedSize: null,
        adjustedStopPct: -5,
        modelUsed: 'none',
        reasoningLatencyMs: 0,
      };
    }
    logger.warn('[TVAgent] ANTHROPIC_API_KEY not set — failing CLOSED (veto)');
    recordFailure('no-api-key');
    const failed = failClosedReasoning('no Anthropic API key configured');
    return {
      ...baseDecision,
      verdict: 'veto',
      reasoning: failed.reasoning,
      confidence: failed.confidence,
      adjustedSize: failed.adjustedSize,
      adjustedStopPct: -5,
      modelUsed: 'none',
      reasoningLatencyMs: 0,
    };
  }

  try {
    const client = new Anthropic({ apiKey });
    const corePrompt = buildUserPrompt(ctx);
    const ragBlock = await maybeBuildRagBlock(ctx);
    // Order: RAG (similar trades) → calibration (inside corePrompt) → signal.
    // Each section starts with its own `##` header so Claude can distinguish
    // them. RAG is prepended; calibration is already injected by buildUserPrompt.
    const userPrompt = ragBlock
      ? `${ragBlock}\n\n---\n\n${corePrompt}`
      : corePrompt;
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 800,
      system: FULL_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const text = resp.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
    const parsed = parseDecision(text);
    const latencyMs = Date.now() - startedAt;

    if (!parsed) {
      if (FAIL_MODE === 'open') {
        logger.warn({ rawSnippet: text.slice(0, 300) }, '[TVAgent] reasoner returned unparseable output — failing OPEN (legacy override)');
        recordFailure('unparseable');
        return {
          ...baseDecision,
          verdict: 'approve',
          reasoning: `Claude output unparseable, defaulted to APPROVE. Raw: ${text.slice(0, 200)}`,
          confidence: 0.3,
          adjustedSize: null,
          adjustedStopPct: -5,
          modelUsed: MODEL,
          reasoningLatencyMs: latencyMs,
        };
      }
      logger.warn({ rawSnippet: text.slice(0, 300) }, '[TVAgent] reasoner returned unparseable output — failing CLOSED (veto)');
      recordFailure('unparseable');
      const failed = failClosedReasoning(`Claude output was unparseable (raw: ${text.slice(0, 200)})`);
      return {
        ...baseDecision,
        verdict: 'veto',
        reasoning: failed.reasoning,
        confidence: failed.confidence,
        adjustedSize: failed.adjustedSize,
        adjustedStopPct: -5,
        modelUsed: MODEL,
        reasoningLatencyMs: latencyMs,
      };
    }

    return {
      ...baseDecision,
      verdict: parsed.verdict,
      reasoning: parsed.reasoning,
      confidence: parsed.confidence,
      adjustedSize: parsed.adjustedSizeUsd,
      adjustedStopPct: parsed.adjustedStopPct,
      modelUsed: MODEL,
      reasoningLatencyMs: latencyMs,
    };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const errMsg = err instanceof Error ? err.message : String(err);
    if (FAIL_MODE === 'open') {
      logger.warn({ err: errMsg, latencyMs }, '[TVAgent] reasoner threw — failing OPEN (legacy override)');
      recordFailure('threw');
      return {
        ...baseDecision,
        verdict: 'approve',
        reasoning: `Reasoner threw: ${errMsg}. Defaulted to APPROVE.`,
        confidence: 0.3,
        adjustedSize: null,
        adjustedStopPct: -5,
        modelUsed: MODEL,
        reasoningLatencyMs: latencyMs,
      };
    }
    logger.warn({ err: errMsg, latencyMs }, '[TVAgent] reasoner threw — failing CLOSED (veto)');
    recordFailure('threw');
    const failed = failClosedReasoning(`reasoner threw an exception (${errMsg})`);
    return {
      ...baseDecision,
      verdict: 'veto',
      reasoning: failed.reasoning,
      confidence: failed.confidence,
      adjustedSize: failed.adjustedSize,
      adjustedStopPct: -5,
      modelUsed: MODEL,
      reasoningLatencyMs: latencyMs,
    };
  }
}
