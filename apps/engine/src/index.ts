import 'dotenv/config';
import { Orchestrator } from './orchestrator.js';

const orchestrator = new Orchestrator();

async function main(): Promise<void> {
  console.log('[TradeWorks Engine] Starting up...');
  console.log(`[TradeWorks Engine] Environment: ${process.env.NODE_ENV ?? 'development'}`);
  console.log(`[TradeWorks Engine] Cycle interval: ${process.env.CYCLE_INTERVAL_MS ?? '300000'}ms`);

  try {
    await orchestrator.start();
  } catch (error) {
    console.error('[TradeWorks Engine] Fatal error during startup:', error);
    process.exit(1);
  }
}

function shutdown(signal: string): void {
  console.log(`\n[TradeWorks Engine] Received ${signal}. Shutting down gracefully...`);
  orchestrator.stop();

  // Allow 10 seconds for graceful shutdown before forcing exit
  setTimeout(() => {
    console.error('[TradeWorks Engine] Forced shutdown after timeout.');
    process.exit(1);
  }, 10_000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  console.error('[TradeWorks Engine] Unhandled rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[TradeWorks Engine] Uncaught exception:', error);
  shutdown('uncaughtException');
});

main();
