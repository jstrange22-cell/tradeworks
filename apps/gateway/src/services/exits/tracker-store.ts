/**
 * Per-position high/low tracker, persisted to data/exit-tracker.json so
 * highSinceEntry / lowSinceEntry survive a gateway restart.
 *
 * Each tracker entry is keyed by `trackerId` (the unique ID the position
 * adapters mint, stable across ticks). Entries auto-expire 24 hours after
 * lastEvaluatedAt to avoid leaking memory if a position closes outside
 * the monitor's view (e.g. operator deletes it manually).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { logger } from '../../lib/logger.js';
import type { PositionTrackerState } from './types.js';

const TRACKER_FILE = resolve(
  process.env['EXIT_TRACKER_FILE'] ?? './data/exit-tracker.json',
);
const STALE_MS = 24 * 60 * 60 * 1000;

interface TrackerFileShape {
  version: number;
  entries: PositionTrackerState[];
}

let memo: Map<string, PositionTrackerState> | null = null;

function ensureDir(): void {
  try {
    mkdirSync(dirname(TRACKER_FILE), { recursive: true });
  } catch {
    /* exists or unwritable */
  }
}

function load(): Map<string, PositionTrackerState> {
  if (memo) return memo;

  const map = new Map<string, PositionTrackerState>();
  if (!existsSync(TRACKER_FILE)) {
    memo = map;
    return map;
  }
  try {
    const raw = JSON.parse(readFileSync(TRACKER_FILE, 'utf-8')) as TrackerFileShape;
    const cutoff = Date.now() - STALE_MS;
    for (const entry of raw.entries ?? []) {
      const lastMs = new Date(entry.lastEvaluatedAt).getTime();
      if (Number.isFinite(lastMs) && lastMs >= cutoff) {
        map.set(entry.trackerId, entry);
      }
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err, file: TRACKER_FILE },
      '[exits.tracker] failed to read tracker — starting fresh',
    );
  }
  memo = map;
  return map;
}

function persist(): void {
  if (!memo) return;
  ensureDir();
  const file: TrackerFileShape = {
    version: 1,
    entries: Array.from(memo.values()),
  };
  try {
    writeFileSync(TRACKER_FILE, JSON.stringify(file, null, 2), 'utf-8');
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err, file: TRACKER_FILE },
      '[exits.tracker] failed to persist tracker',
    );
  }
}

// ── Public API ─────────────────────────────────────────────────────────

/** Read the tracker entry for a given position (creates a default if missing). */
export function getTrackerState(
  trackerId: string,
  defaults: { entryPrice: number },
): PositionTrackerState {
  const map = load();
  const existing = map.get(trackerId);
  if (existing) return existing;
  const fresh: PositionTrackerState = {
    trackerId,
    highSinceEntry: defaults.entryPrice,
    lowSinceEntry: defaults.entryPrice,
    ladderPartialDone: false,
    lastEvaluatedAt: new Date().toISOString(),
  };
  map.set(trackerId, fresh);
  return fresh;
}

/** Update a tracker entry. Persists immediately so a restart mid-tick is safe. */
export function updateTrackerState(state: PositionTrackerState): void {
  const map = load();
  map.set(state.trackerId, state);
  persist();
}

/** Drop the tracker entry for a closed position. */
export function clearTrackerState(trackerId: string): void {
  const map = load();
  if (map.delete(trackerId)) {
    persist();
  }
}

/** Drop every entry whose trackerId is not in the active set (stale cleanup). */
export function pruneStale(activeIds: Set<string>): number {
  const map = load();
  let removed = 0;
  for (const id of [...map.keys()]) {
    if (!activeIds.has(id)) {
      map.delete(id);
      removed++;
    }
  }
  if (removed > 0) persist();
  return removed;
}

/** Test-only: reset the in-memory cache. */
export function _resetTrackerCache(): void {
  memo = null;
}

/** Test-only: snapshot all current entries. */
export function _allEntries(): PositionTrackerState[] {
  return Array.from(load().values());
}
