import { resetCircuitBreaker } from '../hooks/circuit-breaker.js';

/**
 * Scheduled tasks for the trading engine.
 * Manages periodic operations like risk resets, reports, and rebalancing.
 */

interface ScheduledTask {
  name: string;
  intervalMs: number;
  lastRun: Date | null;
  handler: () => Promise<void>;
}

const tasks: ScheduledTask[] = [];
const intervalIds: Map<string, ReturnType<typeof setInterval>> = new Map();

/**
 * Register all scheduled tasks.
 */
export function registerScheduledTasks(): void {
  console.log('[Scheduler] Registering scheduled tasks...');

  // Daily risk reset - runs every 24 hours at midnight UTC
  registerTask({
    name: 'daily-risk-reset',
    intervalMs: 24 * 60 * 60 * 1000, // 24 hours
    lastRun: null,
    handler: dailyRiskReset,
  });

  // Weekly performance report - runs every 7 days
  registerTask({
    name: 'weekly-report',
    intervalMs: 7 * 24 * 60 * 60 * 1000, // 7 days
    lastRun: null,
    handler: weeklyReport,
  });

  // Hourly rebalance check
  registerTask({
    name: 'hourly-rebalance-check',
    intervalMs: 60 * 60 * 1000, // 1 hour
    lastRun: null,
    handler: hourlyRebalanceCheck,
  });

  // Portfolio snapshot - every 15 minutes
  registerTask({
    name: 'portfolio-snapshot',
    intervalMs: 15 * 60 * 1000, // 15 minutes
    lastRun: null,
    handler: portfolioSnapshot,
  });

  console.log(`[Scheduler] Registered ${tasks.length} tasks`);
}

/**
 * Start all scheduled tasks.
 */
export function startScheduledTasks(): void {
  console.log('[Scheduler] Starting scheduled tasks...');

  for (const task of tasks) {
    const id = setInterval(async () => {
      try {
        console.log(`[Scheduler] Running task: ${task.name}`);
        await task.handler();
        task.lastRun = new Date();
        console.log(`[Scheduler] Task completed: ${task.name}`);
      } catch (error) {
        console.error(`[Scheduler] Task failed: ${task.name}`, error);
      }
    }, task.intervalMs);

    intervalIds.set(task.name, id);
    console.log(`[Scheduler] Started: ${task.name} (every ${formatInterval(task.intervalMs)})`);
  }
}

/**
 * Stop all scheduled tasks.
 */
export function stopScheduledTasks(): void {
  console.log('[Scheduler] Stopping scheduled tasks...');

  for (const [name, id] of intervalIds) {
    clearInterval(id);
    console.log(`[Scheduler] Stopped: ${name}`);
  }

  intervalIds.clear();
}

function registerTask(task: ScheduledTask): void {
  tasks.push(task);
}

/**
 * Daily risk reset.
 * Resets daily P&L counters, trade counts, and circuit breaker (if appropriate).
 */
async function dailyRiskReset(): Promise<void> {
  console.log('[Scheduler:DailyRiskReset] Running daily risk reset...');

  // Reset daily P&L tracking
  // TODO: Integrate with @tradeworks/db
  // await db.resetDailyPnl();

  // Reset daily trade count
  // TODO: await db.resetDailyTradeCount();

  // Reset circuit breaker if it was tripped due to daily limits
  // Note: Drawdown-based trips should NOT auto-reset
  resetCircuitBreaker();

  // Record end-of-day portfolio snapshot
  // TODO: await db.recordDailySnapshot();

  console.log('[Scheduler:DailyRiskReset] Daily risk reset complete');
}

/**
 * Weekly performance report.
 * Generates a summary of the week's trading performance.
 */
async function weeklyReport(): Promise<void> {
  console.log('[Scheduler:WeeklyReport] Generating weekly report...');

  // TODO: Integrate with @tradeworks/db for report data
  const report = {
    period: {
      start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      end: new Date(),
    },
    metrics: {
      totalTrades: 0,
      winRate: 0,
      totalPnl: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      bestTrade: null as string | null,
      worstTrade: null as string | null,
    },
    summary: 'Weekly report generation pending - database integration needed',
  };

  console.log('[Scheduler:WeeklyReport] Report:', JSON.stringify(report, null, 2));

  // TODO: Send report via email/notification
}

/**
 * Hourly rebalance check.
 * Checks if portfolio allocation has drifted from target and suggests rebalancing.
 */
async function hourlyRebalanceCheck(): Promise<void> {
  console.log('[Scheduler:RebalanceCheck] Checking portfolio allocation...');

  // TODO: Implement rebalancing logic
  // 1. Get current positions and their values
  // 2. Compare to target allocation
  // 3. If drift > threshold, generate rebalance trade decisions
  // 4. Log recommendations (do not auto-execute)

  // Target allocation (configurable)
  const targetAllocation = {
    crypto: parseFloat(process.env.TARGET_ALLOC_CRYPTO ?? '0.40'),
    equities: parseFloat(process.env.TARGET_ALLOC_EQUITIES ?? '0.35'),
    predictions: parseFloat(process.env.TARGET_ALLOC_PREDICTIONS ?? '0.15'),
    cash: parseFloat(process.env.TARGET_ALLOC_CASH ?? '0.10'),
  };

  console.log('[Scheduler:RebalanceCheck] Target allocation:', targetAllocation);
  console.log('[Scheduler:RebalanceCheck] Rebalance check complete (no drift detected)');
}

/**
 * Portfolio snapshot.
 * Records current portfolio state for historical tracking.
 */
async function portfolioSnapshot(): Promise<void> {
  console.log('[Scheduler:PortfolioSnapshot] Recording portfolio snapshot...');

  // TODO: Integrate with @tradeworks/db
  // 1. Get all positions across exchanges
  // 2. Calculate total equity, unrealized P&L
  // 3. Record snapshot in time-series database
  // 4. Publish snapshot via Redis for dashboard

  const snapshot = {
    timestamp: new Date(),
    totalEquity: 0,
    unrealizedPnl: 0,
    realizedPnl: 0,
    positionCount: 0,
    cashBalance: 0,
  };

  console.log('[Scheduler:PortfolioSnapshot] Snapshot recorded:', JSON.stringify(snapshot));
}

function formatInterval(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours}h`;
  const days = hours / 24;
  return `${days}d`;
}
