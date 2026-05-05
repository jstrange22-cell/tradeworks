/**
 * Nightly calibration scheduler.
 *
 * Runs `runCalibration()` once per day at 03:00 ET. We use a plain
 * setTimeout chain (not node-cron) to avoid adding a new dependency.
 * The schedule recomputes the next 03:00 ET on every fire so DST
 * transitions and clock drift can't desync us.
 */

import { logger } from '../../../lib/logger.js';
import { runCalibration } from './index.js';

const RUN_HOUR_ET = 3;          // 03:00 ET
const ET_TZ = 'America/New_York';

let timer: NodeJS.Timeout | null = null;
let stopped = false;

/**
 * Compute milliseconds until the next 03:00 in America/New_York from `from`.
 * If we're already past 03:00 today (in ET), schedule tomorrow.
 *
 * Implementation: convert `from` to ET wall-clock parts via Intl, build the
 * target wall-clock for today, and find the diff against UTC-equivalent.
 * Re-derives the offset for the target day so DST transitions are correct.
 */
function etPartsOf(d: Date): { y: number; mo: number; dy: number; h: number; mi: number; s: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const part = (t: string): number =>
    Number(parts.find((p) => p.type === t)?.value ?? '0');
  return {
    y: part('year'),
    mo: part('month'),
    dy: part('day'),
    h: part('hour'),
    mi: part('minute'),
    s: part('second'),
  };
}

/** Return the UTC instant corresponding to the wall-clock RUN_HOUR_ET:00:00 on the same ET-day as `d`. */
function etRunInstantOnSameDay(d: Date): number {
  const p = etPartsOf(d);
  // Pseudo-UTC encoding of d's ET wall-clock parts:
  const pseudoNow = Date.UTC(p.y, p.mo - 1, p.dy, p.h, p.mi, p.s);
  const nowSec = Math.floor(d.getTime() / 1000) * 1000;
  const offsetMs = pseudoNow - nowSec;
  // Target UTC instant for ET wall-clock today @ RUN_HOUR_ET:00:00
  return Date.UTC(p.y, p.mo - 1, p.dy, RUN_HOUR_ET, 0, 0) - offsetMs;
}

export function msUntilNextRun(from: Date = new Date()): number {
  const nowMs = from.getTime();
  const todayTarget = etRunInstantOnSameDay(from);
  if (todayTarget > nowMs) {
    return todayTarget - nowMs;
  }
  // Already past today's run — compute target on the *next* ET-day.
  // Use noon-ish on the next ET day to avoid DST edge cases (DST transitions
  // happen at 02:00 ET; at noon we're solidly in the next day's offset).
  const nextEtDayProbe = new Date(todayTarget + 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000);
  const tomorrowTarget = etRunInstantOnSameDay(nextEtDayProbe);
  return tomorrowTarget - nowMs;
}

async function runOnceAndReschedule(): Promise<void> {
  if (stopped) return;
  try {
    const result = await runCalibration();
    logger.info(
      { rowCount: result.rowCount, summaryBytes: result.summaryBytes },
      '[calibration.scheduler] nightly run succeeded',
    );
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : err },
      '[calibration.scheduler] nightly run failed',
    );
  }
  // Schedule next run
  if (!stopped) {
    const delay = msUntilNextRun();
    timer = setTimeout(runOnceAndReschedule, delay);
    timer.unref?.();
    logger.info({ nextRunInMs: delay }, '[calibration.scheduler] next run scheduled');
  }
}

/**
 * Start the nightly scheduler. Idempotent — calling twice is a no-op.
 * If `runOnStart=true`, fires `runCalibration` immediately (useful when
 * the data/ files are missing or stale on boot).
 */
export function startCalibrationScheduler(opts: { runOnStart?: boolean } = {}): void {
  if (timer) {
    logger.warn('[calibration.scheduler] already started — ignoring start()');
    return;
  }
  stopped = false;
  const delay = msUntilNextRun();
  timer = setTimeout(runOnceAndReschedule, delay);
  timer.unref?.();
  logger.info(
    { nextRunInMs: delay, runHourEt: RUN_HOUR_ET },
    '[calibration.scheduler] started',
  );

  if (opts.runOnStart) {
    void runCalibration().catch((err) => {
      logger.error(
        { err: err instanceof Error ? err.message : err },
        '[calibration.scheduler] runOnStart failed',
      );
    });
  }
}

export function stopCalibrationScheduler(): void {
  stopped = true;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
