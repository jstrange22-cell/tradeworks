/**
 * CLV Tracker — Closing Line Value
 *
 * The #1 metric for sports betting quality.
 * Tracks whether our bet odds were better than the closing line.
 * Rolling CLV > 0 = finding real edge. CLV < 0 = getting lucky or losing.
 */

import { logger } from '../../lib/logger.js';
import type { CLVRecord, SportsEngine } from './sports-models.js';

// ── State ────────────────────────────────────────────────────────────────

const clvRecords: CLVRecord[] = [];
const MAX_RECORDS = 1000;

// ── Record CLV ──────────────────────────────────────────────────────────

export function recordCLV(record: CLVRecord): void {
  clvRecords.push(record);
  if (clvRecords.length > MAX_RECORDS) clvRecords.shift();

  logger.info(
    { engine: record.engine, clv: record.clv.toFixed(3), pnl: record.pnl.toFixed(2) },
    `[CLV] ${record.engine}: CLV ${record.clv > 0 ? '+' : ''}${record.clv.toFixed(3)} | P&L $${record.pnl.toFixed(2)}`,
  );
}

// ── Rolling CLV per Engine ──────────────────────────────────────────────

export function getRollingCLV(engine: SportsEngine, window = 100): number | null {
  const engineRecords = clvRecords.filter(r => r.engine === engine).slice(-window);
  if (engineRecords.length < 10) return null; // Not enough data

  const avgClv = engineRecords.reduce((sum, r) => sum + r.clv, 0) / engineRecords.length;
  return avgClv;
}

export function isEngineThrottled(engine: SportsEngine): boolean {
  const clv = getRollingCLV(engine);
  if (clv === null) return false; // Not enough data to judge
  return clv < -0.02; // Throttle if rolling CLV < -2%
}

// ── CLV Report ──────────────────────────────────────────────────────────

export function getCLVReport(): {
  totalRecords: number;
  byEngine: Record<string, {
    records: number;
    avgClv: number;
    totalPnl: number;
    winRate: number;
    throttled: boolean;
  }>;
  overallClv: number;
} {
  const byEngine: Record<string, { records: number; totalClv: number; totalPnl: number; wins: number }> = {};

  for (const r of clvRecords) {
    if (!byEngine[r.engine]) byEngine[r.engine] = { records: 0, totalClv: 0, totalPnl: 0, wins: 0 };
    byEngine[r.engine].records++;
    byEngine[r.engine].totalClv += r.clv;
    byEngine[r.engine].totalPnl += r.pnl;
    if (r.pnl > 0) byEngine[r.engine].wins++;
  }

  const result: Record<string, { records: number; avgClv: number; totalPnl: number; winRate: number; throttled: boolean }> = {};
  for (const [eng, data] of Object.entries(byEngine)) {
    result[eng] = {
      records: data.records,
      avgClv: data.records > 0 ? Math.round((data.totalClv / data.records) * 1000) / 1000 : 0,
      totalPnl: Math.round(data.totalPnl * 100) / 100,
      winRate: data.records > 0 ? Math.round((data.wins / data.records) * 100) : 0,
      throttled: isEngineThrottled(eng as SportsEngine),
    };
  }

  const overallClv = clvRecords.length > 0
    ? clvRecords.reduce((s, r) => s + r.clv, 0) / clvRecords.length
    : 0;

  return { totalRecords: clvRecords.length, byEngine: result, overallClv: Math.round(overallClv * 1000) / 1000 };
}
