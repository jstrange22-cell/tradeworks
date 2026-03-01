import type { EngineExecutionResult } from '../orchestrator.js';

/**
 * Post-trade logging hook.
 * Runs after every trade execution to log, update state, and publish events.
 */

export interface PostTradeResult {
  logged: boolean;
  positionsUpdated: boolean;
  published: boolean;
  errors: string[];
}

/**
 * Run all post-trade hooks after an execution.
 */
export async function runPostTradeHook(execution: EngineExecutionResult): Promise<PostTradeResult> {
  console.log(`[PostTradeHook] Processing execution: ${execution.orderId} (${execution.status})`);

  const result: PostTradeResult = {
    logged: false,
    positionsUpdated: false,
    published: false,
    errors: [],
  };

  // Step 1: Log trade to database
  try {
    await logTradeToDatabase(execution);
    result.logged = true;
    console.log(`[PostTradeHook] Trade logged: ${execution.orderId}`);
  } catch (error) {
    result.errors.push(`Failed to log trade: ${String(error)}`);
    console.error('[PostTradeHook] Failed to log trade:', error);
  }

  // Step 2: Update positions
  try {
    await updatePositions(execution);
    result.positionsUpdated = true;
    console.log(`[PostTradeHook] Positions updated for ${execution.instrument}`);
  } catch (error) {
    result.errors.push(`Failed to update positions: ${String(error)}`);
    console.error('[PostTradeHook] Failed to update positions:', error);
  }

  // Step 3: Publish event via Redis
  try {
    await publishTradeEvent(execution);
    result.published = true;
    console.log(`[PostTradeHook] Trade event published: ${execution.orderId}`);
  } catch (error) {
    result.errors.push(`Failed to publish event: ${String(error)}`);
    console.error('[PostTradeHook] Failed to publish event:', error);
  }

  // Step 4: Update daily P&L tracking
  try {
    await updateDailyPnl(execution);
  } catch (error) {
    result.errors.push(`Failed to update daily P&L: ${String(error)}`);
    console.error('[PostTradeHook] Failed to update daily P&L:', error);
  }

  // Step 5: Check if any alerts need to be sent
  try {
    await checkAlerts(execution);
  } catch (error) {
    result.errors.push(`Failed to check alerts: ${String(error)}`);
    console.error('[PostTradeHook] Failed to check alerts:', error);
  }

  if (result.errors.length > 0) {
    console.warn(`[PostTradeHook] Completed with ${result.errors.length} error(s)`);
  } else {
    console.log('[PostTradeHook] All post-trade hooks completed successfully');
  }

  return result;
}

/**
 * Log trade execution to the database.
 */
async function logTradeToDatabase(execution: EngineExecutionResult): Promise<void> {
  // TODO: Integrate with @tradeworks/db
  // Insert trade record with:
  // - orderId, instrument, side, quantity, price
  // - status, timestamp, exchange
  // - execution metadata (slippage, latency, etc.)

  const tradeRecord = {
    orderId: execution.orderId,
    instrument: execution.instrument,
    side: execution.side,
    quantity: execution.quantity,
    price: execution.price,
    status: execution.status,
    timestamp: execution.timestamp,
    error: execution.error,
    createdAt: new Date(),
  };

  console.log(`[PostTradeHook] Trade record:`, JSON.stringify(tradeRecord));
}

/**
 * Update position tracking after a trade.
 */
async function updatePositions(execution: EngineExecutionResult): Promise<void> {
  if (execution.status === 'failed' || execution.status === 'cancelled') {
    return; // No position update needed for failed/cancelled trades
  }

  // TODO: Integrate with @tradeworks/db position tracking
  // - If opening a new position: create position record
  // - If adding to existing: update quantity and average price
  // - If closing: update or remove position record
  // - Calculate new unrealized P&L
}

/**
 * Publish trade event to Redis pub/sub for real-time clients.
 */
async function publishTradeEvent(execution: EngineExecutionResult): Promise<void> {
  // TODO: Integrate with Redis publisher
  // Publish to channel: trades:live
  // Payload: { type: 'trade_execution', data: execution }

  const event = {
    type: 'trade_execution',
    channel: 'trades:live',
    data: {
      orderId: execution.orderId,
      instrument: execution.instrument,
      side: execution.side,
      quantity: execution.quantity,
      price: execution.price,
      status: execution.status,
      timestamp: execution.timestamp.toISOString(),
    },
  };

  console.log(`[PostTradeHook] Publishing event:`, event.type);
}

/**
 * Update daily P&L tracking.
 */
async function updateDailyPnl(execution: EngineExecutionResult): Promise<void> {
  if (execution.status !== 'filled') return;

  // TODO: Calculate P&L impact
  // - For new positions: no realized P&L yet
  // - For closing positions: calculate realized P&L from entry vs exit price
  // - Update daily cumulative P&L
  // - Check if daily loss limit is being approached
}

/**
 * Check if any alerts need to be sent after this trade.
 */
async function checkAlerts(execution: EngineExecutionResult): Promise<void> {
  // Alerts to check:
  // 1. Large trade alert (above threshold)
  // 2. Failed trade alert
  // 3. Daily P&L threshold alerts
  // 4. Position concentration alerts

  if (execution.status === 'failed') {
    console.warn(`[PostTradeHook] ALERT: Trade failed - ${execution.instrument}: ${execution.error}`);
    // TODO: Send alert via notification system
  }

  const largeTradeThreshold = parseFloat(process.env.LARGE_TRADE_THRESHOLD ?? '10000');
  const tradeValue = execution.quantity * execution.price;
  if (tradeValue > largeTradeThreshold) {
    console.log(`[PostTradeHook] ALERT: Large trade executed - $${tradeValue.toFixed(2)}`);
    // TODO: Send alert via notification system
  }
}
