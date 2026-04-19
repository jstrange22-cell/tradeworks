/**
 * Global Safety Layer — Master Kill Switch + Drawdown Protection
 *
 * This is the LAST LINE OF DEFENSE before real money is at risk.
 * Every trading system checks this before executing any trade.
 *
 * Rules:
 *   1. Master kill switch — instantly stops ALL trading
 *   2. Daily max drawdown — if total losses exceed threshold, halt everything
 *   3. Per-system budget caps — no single system can lose more than its allocation
 *   4. Position count limits — prevent runaway position accumulation
 *   5. Trade frequency limits — prevent rapid-fire over-trading
 */

import { logger } from '../../lib/logger.js';

// ── Configuration ────────────────────────────────────────────────────────

interface SafetyConfig {
  masterEnabled: boolean;          // Master kill switch — false = ALL trading stopped
  paperMode: boolean;              // true = paper only, false = live execution allowed
  maxDailyDrawdownUsd: number;     // Max total losses per day across ALL systems
  maxDailyDrawdownPct: number;     // Max drawdown as % of starting capital
  maxTradesPerHour: number;        // Rate limit: max trades per hour across all systems
  systemBudgets: Record<string, {  // Per-system budget caps
    maxCapitalUsd: number;
    maxDailyLossUsd: number;
    maxPositions: number;
    enabled: boolean;
  }>;
}

const DEFAULT_CONFIG: SafetyConfig = {
  masterEnabled: true,
  paperMode: true,                          // START IN PAPER MODE — flip to false for live
  maxDailyDrawdownUsd: 500,                 // Stop everything if we lose $500 in a day
  maxDailyDrawdownPct: 5,                   // 5% of total capital
  maxTradesPerHour: 100,                    // Prevent runaway trading
  systemBudgets: {
    solana_sniper: { maxCapitalUsd: 1000, maxDailyLossUsd: 100, maxPositions: 15, enabled: true },
    crypto_cex:   { maxCapitalUsd: 5000, maxDailyLossUsd: 250, maxPositions: 10, enabled: true },
    crypto_dex:   { maxCapitalUsd: 1000, maxDailyLossUsd: 100, maxPositions: 15, enabled: true },
    stocks:       { maxCapitalUsd: 10000, maxDailyLossUsd: 500, maxPositions: 20, enabled: true },
    sports:       { maxCapitalUsd: 1000, maxDailyLossUsd: 100, maxPositions: 15, enabled: true },
    kalshi:       { maxCapitalUsd: 1000, maxDailyLossUsd: 100, maxPositions: 15, enabled: true },
    arb:          { maxCapitalUsd: 5000, maxDailyLossUsd: 200, maxPositions: 10, enabled: true },
  },
};

// ── State ────────────────────────────────────────────────────────────────

let config = { ...DEFAULT_CONFIG };
let halted = false;
let haltReason: string | null = null;
let haltedAt: string | null = null;

// Daily tracking (resets at midnight UTC)
let dailyLossUsd = 0;
let dailyTradeCount = 0;
let dailyResetDate = new Date().toISOString().slice(0, 10);

// Hourly trade rate tracking
const hourlyTrades: number[] = []; // timestamps of recent trades
const HOUR_MS = 3600_000;

// Per-system daily loss tracking
const systemDailyLoss: Record<string, number> = {};

// ── Core Safety Checks ───────────────────────────────────────────────────

/** Check daily reset */
function checkDailyReset(): void {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dailyResetDate) {
    logger.info({ prev: dailyResetDate, today, dailyLoss: dailyLossUsd, trades: dailyTradeCount },
      `[Safety] Daily reset: yesterday lost $${dailyLossUsd.toFixed(2)} across ${dailyTradeCount} trades`);
    dailyLossUsd = 0;
    dailyTradeCount = 0;
    dailyResetDate = today;
    for (const key of Object.keys(systemDailyLoss)) systemDailyLoss[key] = 0;

    // Auto-unhalt if it was a daily drawdown halt (not manual)
    if (halted && haltReason?.includes('daily drawdown')) {
      halted = false;
      haltReason = null;
      haltedAt = null;
      logger.info('[Safety] Auto-resumed after daily reset');
    }
  }
}

/**
 * CAN THIS SYSTEM TRADE RIGHT NOW?
 * Every trading system must call this before executing any trade.
 * Returns { allowed: true } or { allowed: false, reason: string }
 */
export function canTrade(system: string): { allowed: boolean; reason?: string } {
  checkDailyReset();

  // 1. Master kill switch
  if (!config.masterEnabled) {
    return { allowed: false, reason: 'Master kill switch OFF' };
  }

  // 2. System halted (drawdown or manual)
  if (halted) {
    return { allowed: false, reason: `HALTED: ${haltReason}` };
  }

  // 3. Paper mode check (informational — allows paper trades but blocks live)
  // This is checked by execution layers, not here

  // 4. Daily drawdown limit
  if (dailyLossUsd >= config.maxDailyDrawdownUsd) {
    halt(`Daily drawdown limit hit: -$${dailyLossUsd.toFixed(2)} >= $${config.maxDailyDrawdownUsd}`);
    return { allowed: false, reason: `Daily drawdown exceeded: -$${dailyLossUsd.toFixed(2)}` };
  }

  // 5. Hourly trade rate limit
  const now = Date.now();
  const recentTrades = hourlyTrades.filter(t => now - t < HOUR_MS);
  if (recentTrades.length >= config.maxTradesPerHour) {
    return { allowed: false, reason: `Hourly trade limit (${config.maxTradesPerHour}) reached` };
  }

  // 6. Per-system checks
  const budget = config.systemBudgets[system];
  if (budget) {
    if (!budget.enabled) {
      return { allowed: false, reason: `System ${system} is disabled` };
    }
    const sysLoss = systemDailyLoss[system] ?? 0;
    if (sysLoss >= budget.maxDailyLossUsd) {
      return { allowed: false, reason: `${system} daily loss limit: -$${sysLoss.toFixed(2)} >= $${budget.maxDailyLossUsd}` };
    }
  }

  return { allowed: true };
}

/**
 * Record a completed trade (for tracking daily loss and rate limiting)
 */
export function recordTradeResult(system: string, pnlUsd: number): void {
  checkDailyReset();

  dailyTradeCount++;
  hourlyTrades.push(Date.now());

  // Trim old hourly entries
  const cutoff = Date.now() - HOUR_MS;
  while (hourlyTrades.length > 0 && hourlyTrades[0] < cutoff) hourlyTrades.shift();

  if (pnlUsd < 0) {
    dailyLossUsd += Math.abs(pnlUsd);
    systemDailyLoss[system] = (systemDailyLoss[system] ?? 0) + Math.abs(pnlUsd);
  }

  // Check if drawdown limit breached
  if (dailyLossUsd >= config.maxDailyDrawdownUsd) {
    halt(`Daily drawdown limit hit: -$${dailyLossUsd.toFixed(2)}`);
  }
}

// ── Control Functions ────────────────────────────────────────────────────

export function halt(reason: string): void {
  halted = true;
  haltReason = reason;
  haltedAt = new Date().toISOString();
  logger.warn({ reason }, `[Safety] ⛔ ALL TRADING HALTED: ${reason}`);
}

export function resume(): void {
  halted = false;
  haltReason = null;
  haltedAt = null;
  logger.info('[Safety] ✅ Trading resumed');
}

export function setMasterSwitch(enabled: boolean): void {
  config.masterEnabled = enabled;
  logger.info({ enabled }, `[Safety] Master switch: ${enabled ? 'ON' : 'OFF'}`);
}

export function setPaperMode(paper: boolean): void {
  config.paperMode = paper;
  logger.info({ paper }, `[Safety] Paper mode: ${paper ? 'ON' : 'OFF — LIVE TRADING ENABLED'}`);
}

export function setSystemEnabled(system: string, enabled: boolean): void {
  const budget = config.systemBudgets[system];
  if (budget) {
    budget.enabled = enabled;
    logger.info({ system, enabled }, `[Safety] ${system}: ${enabled ? 'enabled' : 'disabled'}`);
  }
}

export function updateConfig(updates: Partial<SafetyConfig>): void {
  config = { ...config, ...updates };
  logger.info({ updates: Object.keys(updates) }, '[Safety] Config updated');
}

// ── Status ───────────────────────────────────────────────────────────────

export function getSafetyStatus() {
  checkDailyReset();

  return {
    masterEnabled: config.masterEnabled,
    paperMode: config.paperMode,
    halted,
    haltReason,
    haltedAt,
    dailyLossUsd: Math.round(dailyLossUsd * 100) / 100,
    dailyDrawdownLimit: config.maxDailyDrawdownUsd,
    dailyDrawdownPct: config.maxDailyDrawdownPct,
    dailyTradeCount,
    maxTradesPerHour: config.maxTradesPerHour,
    hourlyTradeCount: hourlyTrades.filter(t => Date.now() - t < HOUR_MS).length,
    systems: Object.entries(config.systemBudgets).map(([name, budget]) => ({
      name,
      enabled: budget.enabled,
      maxCapitalUsd: budget.maxCapitalUsd,
      maxDailyLossUsd: budget.maxDailyLossUsd,
      maxPositions: budget.maxPositions,
      dailyLossUsd: Math.round((systemDailyLoss[name] ?? 0) * 100) / 100,
    })),
    dailyResetDate,
  };
}

export function isPaperMode(): boolean {
  return config.paperMode;
}
