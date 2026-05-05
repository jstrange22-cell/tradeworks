/**
 * CLI entry — prints the current portfolio + per-strategy vol budgets in a
 * readable table. Useful sanity check after deploying or after a bandit
 * recompute.
 *
 * Run with:
 *   pnpm --filter @tradeworks/gateway run-vol-budget
 *
 * Optional env:
 *   MEMORY_DB_URL                  — pulls live realized vol; otherwise defaults
 *   PORTFOLIO_EQUITY_USD           — total account equity (default 100_000)
 *   PORTFOLIO_VOL_TARGET_PCT       — annualized vol target (default 14)
 */

import { initBandit } from '../src/services/orchestrator/bandit-runner.js';
import {
  getAllStrategyVolBudgets,
  getPortfolioVolBudget,
} from '../src/services/orchestrator/vol-target.js';

async function main(): Promise<void> {
  // Load weights file (or cold-start) so getBanditWeight() returns real values.
  await initBandit();

  const portfolio = await getPortfolioVolBudget();
  const strategies = await getAllStrategyVolBudgets();

  // ── header ────────────────────────────────────────────────────────────
  console.log('');
  console.log('PORTFOLIO VOL BUDGET');
  console.log('────────────────────');
  console.log(`  total equity         : $${portfolio.totalEquityUsd.toLocaleString('en-US')}`);
  console.log(`  target vol (annual)  : ${portfolio.targetVolAnnualizedPct.toFixed(2)}%`);
  console.log(`  realized vol (60d)   : ${portfolio.realizedVolAnnualizedPct.toFixed(2)}%`);
  console.log(`  scalar (target/real.): ${portfolio.scalar.toFixed(3)}`);
  console.log(`  budget @ full sizing : $${portfolio.budgetUsdAtFullSizing.toFixed(2)}`);
  console.log(`  effective budget     : $${(portfolio.budgetUsdAtFullSizing * portfolio.scalar).toFixed(2)}`);
  console.log('');

  // ── per-strategy table ───────────────────────────────────────────────
  console.log('PER-STRATEGY BUDGETS');
  console.log('────────────────────');
  const headers = ['strategy', 'bandit_w', 'realized_vol%', 'budget_usd'];
  const rows = strategies.map((s) => [
    s.strategy,
    s.banditWeight.toFixed(4),
    s.realizedVolAnnualizedPct.toFixed(2),
    `$${s.budgetUsd.toFixed(2)}`,
  ]);
  printTable(headers, rows);

  const sum = strategies.reduce((a, s) => a + s.budgetUsd, 0);
  console.log('');
  console.log(`  total allocated      : $${sum.toFixed(2)}`);
  console.log('');
}

function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)),
  );
  const fmtRow = (cells: string[]): string =>
    cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join('  ');

  console.log('  ' + fmtRow(headers));
  console.log('  ' + widths.map((w) => '─'.repeat(w)).join('  '));
  for (const r of rows) console.log('  ' + fmtRow(r));
}

main().catch((err: unknown) => {
  console.error('[vol-budget-cli] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
