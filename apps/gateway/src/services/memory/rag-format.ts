/**
 * Render a SimilarTrade[] into a compact prompt block for the reasoner.
 *
 * Output shape (capped well under 1000 tokens for k≤10):
 *
 *   ## SIMILAR PAST TRADES (top N by similarity)
 *   Across these N historically similar setups: W wins, L losses, avg X.XR, expectancy +$Y
 *   Closest matches:
 *   1. [sim=0.94] AAPL BUY 2026-03-15 (regime=calm, grade=strong) → +1.4R, +$148, target_hit, held 18h
 *   ...
 *   Pattern: <observation> | (or low-confidence note when n<5)
 */

import type { SimilarTrade, SimilarTradeOutcome } from './rag.js';

const MAX_LIST_ITEMS = 10;
const SECTION_HEADER = '## SIMILAR PAST TRADES';

export function formatRagContext(trades: SimilarTrade[]): string {
  if (trades.length === 0) {
    return `${SECTION_HEADER} (none)\nNo historically similar closed trades in memory yet.`;
  }

  const closed = trades.filter((t) => t.outcome !== null);
  const total = trades.length;

  const lines: string[] = [];
  lines.push(`${SECTION_HEADER} (top ${total} by similarity)`);
  lines.push(buildSummaryLine(closed, total));
  lines.push('Closest matches:');

  const limit = Math.min(trades.length, MAX_LIST_ITEMS);
  for (let i = 0; i < limit; i++) {
    const t = trades[i];
    if (!t) continue;
    lines.push(formatTradeLine(i + 1, t));
  }

  const observation = computePatternObservation(closed);
  if (observation) lines.push(`Pattern: ${observation}`);

  return lines.join('\n');
}

// ── helpers ────────────────────────────────────────────────────────────

function buildSummaryLine(closed: SimilarTrade[], total: number): string {
  if (closed.length === 0) {
    return `Across these ${total} similar setups: 0 closed yet (sample too thin to weigh outcomes).`;
  }

  let wins = 0;
  let losses = 0;
  let rSum = 0;
  let rCount = 0;
  let pnlSum = 0;
  for (const t of closed) {
    const o = t.outcome as SimilarTradeOutcome;
    if (o.realizedPnlUsd > 0) wins++;
    else if (o.realizedPnlUsd < 0) losses++;
    if (typeof o.rMultiple === 'number' && Number.isFinite(o.rMultiple)) {
      rSum += o.rMultiple;
      rCount++;
    }
    pnlSum += o.realizedPnlUsd;
  }

  const avgR = rCount > 0 ? rSum / rCount : null;
  const expectancy = pnlSum / closed.length;

  const avgRStr = avgR === null ? 'n/a' : `${avgR >= 0 ? '+' : ''}${avgR.toFixed(2)}R`;
  const expStr = `${expectancy >= 0 ? '+' : ''}$${expectancy.toFixed(0)}`;

  return `Across these ${closed.length} historically similar setups: ${wins} wins, ${losses} losses, avg ${avgRStr}, expectancy ${expStr}`;
}

function formatTradeLine(idx: number, t: SimilarTrade): string {
  const date = t.createdAt.slice(0, 10);
  const sigBits = [
    t.signal.symbol,
    t.signal.action.toUpperCase(),
    date,
  ];
  const meta: string[] = [];
  if (t.signal.regime) meta.push(`regime=${t.signal.regime}`);
  if (t.signal.grade) meta.push(`grade=${t.signal.grade}`);
  if (t.signal.strategy) meta.push(`strategy=${t.signal.strategy}`);
  const metaStr = meta.length > 0 ? ` (${meta.join(', ')})` : '';

  const head = `${idx}. [sim=${t.similarity.toFixed(2)}] ${sigBits.join(' ')}${metaStr}`;

  if (!t.outcome) return `${head} → not yet closed`;

  const o = t.outcome;
  const rStr = typeof o.rMultiple === 'number'
    ? `${o.rMultiple >= 0 ? '+' : ''}${o.rMultiple.toFixed(1)}R`
    : 'n/a R';
  const pnlStr = `${o.realizedPnlUsd >= 0 ? '+' : ''}$${o.realizedPnlUsd.toFixed(0)}`;
  const heldStr = formatDuration(o.holdingMinutes);
  return `${head} → ${rStr}, ${pnlStr}, ${o.exitReason}, held ${heldStr}`;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m`;
  if (minutes < 60 * 24) return `${(minutes / 60).toFixed(1)}h`;
  return `${(minutes / (60 * 24)).toFixed(1)}d`;
}

/**
 * Light-weight pattern detector. Looks at regime split: if one regime has a
 * meaningfully different expectancy than another and we have ≥2 samples in
 * each bucket, surface that. Otherwise return null.
 *
 * Sample-size guard: if total closed < 5, prepend a low-confidence note.
 */
function computePatternObservation(closed: SimilarTrade[]): string | null {
  if (closed.length === 0) return null;
  if (closed.length < 5) {
    return `low-confidence pattern; insufficient sample (n=${closed.length}, want ≥5).`;
  }

  const byRegime = new Map<string, { count: number; pnlSum: number }>();
  for (const t of closed) {
    const regime = t.signal.regime ?? 'unknown';
    const o = t.outcome;
    if (!o) continue;
    const cur = byRegime.get(regime) ?? { count: 0, pnlSum: 0 };
    cur.count += 1;
    cur.pnlSum += o.realizedPnlUsd;
    byRegime.set(regime, cur);
  }

  if (byRegime.size < 2) return null;

  type Bucket = { regime: string; count: number; expectancy: number };
  const buckets: Bucket[] = [];
  for (const [regime, agg] of byRegime.entries()) {
    if (agg.count < 2) continue;
    buckets.push({ regime, count: agg.count, expectancy: agg.pnlSum / agg.count });
  }
  if (buckets.length < 2) return null;

  buckets.sort((a, b) => b.expectancy - a.expectancy);
  const best = buckets[0];
  const worst = buckets[buckets.length - 1];
  if (!best || !worst || best === worst) return null;

  const delta = best.expectancy - worst.expectancy;
  if (Math.abs(delta) < 25) return null; // <$25 swing — not noteworthy

  const direction = worst.expectancy < best.expectancy ? 'lower' : 'higher';
  const pctDelta = best.expectancy === 0
    ? null
    : Math.round(((worst.expectancy - best.expectancy) / Math.abs(best.expectancy)) * 100);
  const pctStr = pctDelta === null ? `${delta >= 0 ? '+' : ''}$${delta.toFixed(0)} swing` : `${pctDelta}%`;

  return `'${worst.regime}' regime has ${pctStr} ${direction} expectancy than '${best.regime}' (n=${worst.count} vs ${best.count}). Consider this when sizing.`;
}
