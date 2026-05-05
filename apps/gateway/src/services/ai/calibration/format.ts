/**
 * Renderers: turn a CalibrationReport into:
 *   1. compact prompt-injectable Markdown (`renderSummary`) — under ~1500 tokens
 *   2. full JSON (`renderJson`) — written verbatim to data/calibration.json
 */

import { bucketMidpoint, type ConfidenceBucketKey } from './buckets.js';
import type { BucketStats, CalibrationReport } from './aggregate.js';

const MAX_STRATEGIES = 6;
const MAX_REGIMES = 6;
const MAX_HOURS = 4;
const MAX_SECTORS = 8;
const SUMMARY_MAX_BYTES = 6_000; // ~1500 tokens at 4 chars/token

function pct(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function usd(value: number): string {
  const sign = value >= 0 ? '' : '-';
  return `${sign}$${Math.abs(value).toFixed(0)}`;
}

function r(value: number): string {
  return value.toFixed(1);
}

function calibrationFlag(bucketKey: string, winRate: number): string {
  // Only meaningful for confidence buckets (e.g. '0.8-0.9'). Compare WR to midpoint.
  if (!/^\d+\.\d+-\d+\.\d+$/.test(bucketKey)) return '';
  const mid = bucketMidpoint(bucketKey as ConfidenceBucketKey);
  const delta = winRate - mid;
  if (Math.abs(delta) < 0.05) return ' (well-calibrated)';
  if (delta < 0) return ' WARN overconfident';
  return ' (under-confident — opportunity)';
}

function lossFlag(expectancyUsd: number): string {
  return expectancyUsd < 0 ? ' WARN losing' : '';
}

// ── Public: render compact summary ─────────────────────────────────────
export function renderSummary(report: CalibrationReport): string {
  const lines: string[] = [];
  lines.push(`## CALIBRATION (last ${report.windowDays}d, ${report.totalApproves} trades)`);
  lines.push('');

  if (report.totalApproves === 0) {
    lines.push('No closed approves yet — calibration will activate once outcomes are recorded.');
    return lines.join('\n');
  }

  // By strategy
  lines.push('By strategy:');
  for (const s of report.byStrategy.slice(0, MAX_STRATEGIES)) {
    lines.push(
      `- ${s.bucketKey}: WR ${pct(s.winRate)}, avg R ${r(s.avgRMultiple)}, expectancy ${usd(s.expectancyUsd)}, n=${s.n}${lossFlag(s.expectancyUsd)}`,
    );
  }
  lines.push('');

  // By confidence
  lines.push('By confidence bucket (approves only):');
  for (const c of report.byConfidence) {
    if (c.n === 0) continue;
    lines.push(
      `- ${c.bucketKey}: WR ${pct(c.winRate)}, n=${c.n}${calibrationFlag(c.bucketKey, c.winRate)}`,
    );
  }
  lines.push('');

  // By regime
  lines.push('By regime (approves only):');
  for (const rg of report.byRegime.slice(0, MAX_REGIMES)) {
    lines.push(
      `- ${rg.bucketKey}: expectancy ${usd(rg.expectancyUsd)}, n=${rg.n}${lossFlag(rg.expectancyUsd)}`,
    );
  }
  lines.push('');

  // By hour
  lines.push('By session window (ET):');
  for (const h of report.byHour.slice(0, MAX_HOURS)) {
    lines.push(
      `- ${h.bucketKey}: WR ${pct(h.winRate)}, expectancy ${usd(h.expectancyUsd)}, n=${h.n}`,
    );
  }
  lines.push('');

  // By sector
  if (report.bySector.length > 0) {
    lines.push('By sector (top performers + warnings):');
    for (const s of report.bySector.slice(0, MAX_SECTORS)) {
      lines.push(
        `- ${s.bucketKey}: WR ${pct(s.winRate)}, expectancy ${usd(s.expectancyUsd)}, n=${s.n}${lossFlag(s.expectancyUsd)}`,
      );
    }
    lines.push('');
  }

  // Failure modes
  lines.push('Top failure modes (last 30d):');
  if (report.failureModes.highConfLossesLast30d > 0) {
    lines.push(
      `- ${report.failureModes.highConfLossesLast30d} approves with confidence>0.8 closed at <=-1R`,
    );
  }
  if (report.failureModes.volatileNoScoutLossesLast30d > 0) {
    lines.push(
      `- ${report.failureModes.volatileNoScoutLossesLast30d} losing approves in 'volatile' regime with no Scout corroboration`,
    );
  }
  if (
    report.failureModes.highConfLossesLast30d === 0 &&
    report.failureModes.volatileNoScoutLossesLast30d === 0
  ) {
    lines.push('- (no notable failure clusters)');
  }

  let out = lines.join('\n');
  // Hard cap defensively — if we ever blow past 6KB, truncate at a line boundary.
  if (Buffer.byteLength(out, 'utf-8') > SUMMARY_MAX_BYTES) {
    const sliced = out.slice(0, SUMMARY_MAX_BYTES);
    const lastNewline = sliced.lastIndexOf('\n');
    out =
      sliced.slice(0, lastNewline > 0 ? lastNewline : SUMMARY_MAX_BYTES) +
      '\n[truncated]';
  }
  return out;
}

// ── Public: render full JSON for archive ───────────────────────────────
export function renderJson(report: CalibrationReport): string {
  return JSON.stringify(report, null, 2);
}

// ── Internal helpers re-exported for tests ─────────────────────────────
export const __test = {
  pct,
  usd,
  r,
  calibrationFlag,
  lossFlag,
  flagBucket(b: BucketStats): string {
    return calibrationFlag(b.bucketKey, b.winRate);
  },
};
