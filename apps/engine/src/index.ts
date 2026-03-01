import 'dotenv/config';
import { Orchestrator } from './orchestrator.js';
import { registerScheduledTasks, startScheduledTasks, stopScheduledTasks } from './scheduler/cron.js';

// ---------------------------------------------------------------------------
// Startup banner
// ---------------------------------------------------------------------------

const VERSION = '0.1.0';

function printBanner(): void {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════════════╗');
  console.log('  ║                                                              ║');
  console.log('  ║   ████████╗██████╗  █████╗ ██████╗ ███████╗                  ║');
  console.log('  ║      ██╔══╝██╔══██╗██╔══██╗██╔══██╗██╔════╝                  ║');
  console.log('  ║      ██║   ██████╔╝███████║██║  ██║█████╗                    ║');
  console.log('  ║      ██║   ██╔══██╗██╔══██║██║  ██║██╔══╝                    ║');
  console.log('  ║      ██║   ██║  ██║██║  ██║██████╔╝███████╗                  ║');
  console.log('  ║      ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ ╚══════╝                  ║');
  console.log('  ║                                                              ║');
  console.log(`  ║   TradeWorks Autonomous Trading Engine  v${VERSION}             ║`);
  console.log('  ║   Multi-Agent AI-Powered Trading System                      ║');
  console.log('  ║                                                              ║');
  console.log('  ╚══════════════════════════════════════════════════════════════╝');
  console.log('');
}

// ---------------------------------------------------------------------------
// Orchestrator and scheduled tasks
// ---------------------------------------------------------------------------

const orchestrator = new Orchestrator();

async function main(): Promise<void> {
  printBanner();

  const env = process.env.NODE_ENV ?? 'development';
  const config = orchestrator.getConfig();

  console.log(`[Engine] Environment:    ${env}`);
  console.log(`[Engine] Paper trading:  ${config.paperTrading}`);
  console.log(`[Engine] Process PID:    ${process.pid}`);
  console.log(`[Engine] Node version:   ${process.version}`);
  console.log(`[Engine] Platform:       ${process.platform} ${process.arch}`);
  console.log(`[Engine] Memory limit:   ${(process.memoryUsage().heapTotal / 1024 / 1024).toFixed(0)} MB heap`);
  console.log('');

  if (config.paperTrading) {
    console.log('[Engine] *** PAPER TRADING MODE - No real orders will be placed ***');
    console.log('');
  }

  try {
    // Register and start background scheduled tasks (daily resets, snapshots, etc.)
    registerScheduledTasks();
    startScheduledTasks();

    // Start the main orchestrator loop
    await orchestrator.start();
  } catch (error) {
    console.error('[Engine] Fatal error during startup:', error);
    await shutdown('startup_error');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    console.warn('[Engine] Shutdown already in progress, ignoring duplicate signal.');
    return;
  }
  shuttingDown = true;

  console.log('');
  console.log(`[Engine] Received ${signal}. Initiating graceful shutdown...`);

  // Stop accepting new cycles
  try {
    // Stop scheduled tasks first (non-critical)
    stopScheduledTasks();
    console.log('[Engine] Scheduled tasks stopped.');
  } catch (err) {
    console.error('[Engine] Error stopping scheduled tasks:', err);
  }

  try {
    // Stop the orchestrator (waits for in-flight cycle)
    await orchestrator.stop();
    console.log('[Engine] Orchestrator stopped.');
  } catch (err) {
    console.error('[Engine] Error stopping orchestrator:', err);
  }

  console.log('[Engine] Shutdown complete.');
  process.exit(0);
}

// Force exit after timeout if graceful shutdown stalls
function forceExit(signal: string): void {
  setTimeout(() => {
    console.error(`[Engine] Forced exit after ${signal} - graceful shutdown timed out.`);
    process.exit(1);
  }, 15_000).unref(); // unref so it doesn't keep the process alive on its own
}

// Signal handlers
process.on('SIGINT', () => {
  forceExit('SIGINT');
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  forceExit('SIGTERM');
  void shutdown('SIGTERM');
});

// Error handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Engine] Unhandled rejection at:', promise, 'reason:', reason);
  // Don't exit on unhandled rejection in production - log and continue
  if (process.env.NODE_ENV === 'production') {
    return;
  }
});

process.on('uncaughtException', (error) => {
  console.error('[Engine] Uncaught exception:', error);
  void shutdown('uncaughtException');
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error('[Engine] Unhandled error in main():', err);
  process.exit(1);
});
