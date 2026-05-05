/**
 * Ensemble prompt builder — re-uses the same SOUL.md + reasoner instructions
 * from `reasoner.ts`, but builds the user prompt fresh with all the same
 * sections (PORTFOLIO / DAILY P&L / MACRO / SCOUT / NEWS / CHART) so each
 * ensemble model sees the SAME context the solo reasoner does.
 *
 * After C2/C3/C5 land (calibration / RAG / learned-heuristics), the user
 * prompt should be enriched in `reasoner.ts:buildUserPrompt()` and this
 * builder should mirror those changes — keeping a single source of truth is
 * preferable but at the time of implementation those sections didn't exist
 * yet, so we duplicate the structure here to avoid coupling to `reasoner.ts`
 * internals.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { SignalContext } from './types.js';

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

const ENSEMBLE_REASONER_INSTRUCTIONS = `

## YOUR ROLE — ENSEMBLE MEMBER
You are ONE of 3 AI models being asked to evaluate the SAME TradeVisor signal independently. Your verdict will be combined with the other models via a consensus algorithm. Be honest about uncertainty — disagreement between models is a useful signal, not something to avoid.

## DECISION CRITERIA (all must align for APPROVE)
1. **Portfolio room**: position count below cap, sector cap not breached, target symbol not already held (sells exempt).
2. **Daily P&L room**: not within 0.5% of the daily loss limit.
3. **News sanity**: no breaking negative catalyst in last 24h that contradicts the signal direction.
4. **Macro alignment**: in 'risk-off' or 'crisis' regime, BUY signals require Scout rank top-10 OR atrExpansion > 1.5x to APPROVE.
5. **Scout corroboration**: prefer watchlist names. Off-watchlist signals require BOTH chart confluence AND clean news.

## ESCALATE (don't auto-act) when
- Stake > $5,000 OR > 5% of portfolio
- Macro regime is 'crisis'
- News contains regulatory action against the issuer
- Signal contradicts an existing position (e.g. BUY on a name we just shorted)
- Stop placement is unclear (no obvious chart structure to anchor it)

## SIZING LADDER (default — adjust ±50% based on conviction)
- standard score=4 → $100 base
- strong score=5 → $250 base
- prime score=6 → $500 base

You MAY recommend SIZE = 0 alongside VETO to make the rejection unambiguous.

## OUTPUT FORMAT — STRICT JSON
Respond with ONLY a single JSON object, no prose, no markdown fences:
{
  "verdict": "approve" | "veto" | "escalate",
  "reasoning": "2-4 sentence explanation citing specific context fields",
  "confidence": 0.0..1.0,
  "adjustedSizeUsd": null | number,
  "adjustedStopPct": -3.0..-10.0
}
`;

const FULL_SYSTEM_PROMPT = SOUL_PROMPT + ENSEMBLE_REASONER_INSTRUCTIONS;

export function buildEnsembleSystemPrompt(): string {
  return FULL_SYSTEM_PROMPT;
}

export function buildEnsembleUserPrompt(ctx: SignalContext): string {
  const s = ctx.signal;
  const lines: string[] = [];
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
  const sectorOfSymbol = ctx.portfolio.equityPositions.find((p) => p.symbol === s.symbol)?.sector ?? 'unknown';
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
