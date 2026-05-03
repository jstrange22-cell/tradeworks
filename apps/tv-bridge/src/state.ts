import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname } from 'path';

export interface BridgeState {
  // Per-(symbol|timeframe) bookmark of the highest label.id we've already fired on.
  // Key shape: `${symbol}|${timeframe}` (e.g. "AMEX:SPY|15").
  lastSeenIdByKey: Record<string, number>;
}

const DEFAULT: BridgeState = { lastSeenIdByKey: {} };

export function loadState(path: string): BridgeState {
  if (!existsSync(path)) return { ...DEFAULT };
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<BridgeState>;
    return { ...DEFAULT, ...parsed, lastSeenIdByKey: { ...(parsed.lastSeenIdByKey ?? {}) } };
  } catch {
    return { ...DEFAULT };
  }
}

export function saveState(path: string, state: BridgeState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}

export function key(symbol: string, timeframe: string): string {
  return `${symbol}|${timeframe}`;
}
