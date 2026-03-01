import type { BacktestResult } from './engine.js';

/**
 * Generate a formatted text report from backtest results.
 */
export function generateReport(result: BacktestResult): string {
  const { config, metrics } = result;
  const lines: string[] = [];

  lines.push('═══════════════════════════════════════════════');
  lines.push('           TRADEWORKS BACKTEST REPORT          ');
  lines.push('═══════════════════════════════════════════════');
  lines.push('');
  lines.push(`Strategy:        ${config.strategy.name}`);
  lines.push(`Instrument:      ${config.instrument}`);
  lines.push(`Market:          ${config.market}`);
  lines.push(`Timeframe:       ${config.timeframe}`);
  lines.push(`Initial Capital: $${config.initialCapital.toLocaleString()}`);
  lines.push(`Risk Per Trade:  ${(config.riskPerTrade * 100).toFixed(1)}%`);
  lines.push(`Commission:      ${(config.commissionRate * 100).toFixed(2)}%`);
  lines.push(`Slippage:        ${config.slippageBps} bps`);
  lines.push('');
  lines.push('───────────── Performance ─────────────');
  lines.push(`Total Return:     $${metrics.totalReturn.toFixed(2)} (${metrics.totalReturnPercent.toFixed(2)}%)`);
  lines.push(`Sharpe Ratio:     ${metrics.sharpeRatio.toFixed(3)}`);
  lines.push(`Sortino Ratio:    ${metrics.sortinoRatio.toFixed(3)}`);
  lines.push(`Calmar Ratio:     ${metrics.calmarRatio.toFixed(3)}`);
  lines.push(`Max Drawdown:     ${(metrics.maxDrawdown * 100).toFixed(2)}% ($${metrics.maxDrawdownAbsolute.toFixed(2)})`);
  lines.push('');
  lines.push('───────────── Trade Stats ─────────────');
  lines.push(`Total Trades:     ${metrics.totalTrades}`);
  lines.push(`Win Rate:         ${(metrics.winRate * 100).toFixed(1)}%`);
  lines.push(`Winning Trades:   ${metrics.winningTrades}`);
  lines.push(`Losing Trades:    ${metrics.losingTrades}`);
  lines.push(`Avg Win:          $${metrics.avgWin.toFixed(2)}`);
  lines.push(`Avg Loss:         $${metrics.avgLoss.toFixed(2)}`);
  lines.push(`Profit Factor:    ${metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(3)}`);
  lines.push(`Expectancy:       $${metrics.expectancy.toFixed(2)} per trade`);
  lines.push('');
  lines.push('═══════════════════════════════════════════════');

  return lines.join('\n');
}
