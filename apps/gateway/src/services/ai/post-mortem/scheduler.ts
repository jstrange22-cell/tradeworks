/**
 * Post-mortem scheduler — fires `runPostMortem()` once per night at the
 * configured wall-clock time. Default: 02:30 America/New_York (ET).
 *
 * Implementation: lightweight setInterval-based ticker that checks once a
 * minute whether the target hour:minute has just been crossed since the
 * last run. No external cron lib — keeps the gateway dependency surface flat.
 *
 * Idempotency: we record the last successful run and refuse to re-run on
 * the same calendar day (in target timezone) even if the process restarts.
 */
import { logger } from '../../../lib/logger.js';
import { runPostMortem, type PostMortemRunResult } from './index.js';

const TICK_MS = 60_000; // check every minute
const DEFAULT_HOUR_ET = 2;
const DEFAULT_MINUTE_ET = 30;
const ET_TIMEZONE = 'America/New_York';

let timer: NodeJS.Timeout | null = null;
let lastRunDateStr: string | null = null; // YYYY-MM-DD in ET
let inFlight = false;

interface ETClock { year: number; month: number; day: number; hour: number; minute: number; }

function nowInET(): ETClock {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '0';
  return {
    year: parseInt(get('year'), 10),
    month: parseInt(get('month'), 10),
    day: parseInt(get('day'), 10),
    hour: parseInt(get('hour'), 10) % 24, // formatToParts may emit "24" for midnight
    minute: parseInt(get('minute'), 10),
  };
}

function clockToDateStr(c: ETClock): string {
  return `${c.year}-${String(c.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`;
}

async function tick(targetHour: number, targetMinute: number): Promise<void> {
  if (inFlight) return;
  const c = nowInET();
  const today = clockToDateStr(c);

  // Already ran today
  if (lastRunDateStr === today) return;

  // Have we crossed the target time?
  const minutesNow = c.hour * 60 + c.minute;
  const minutesTarget = targetHour * 60 + targetMinute;
  // Allow firing within a 15-minute window after target so we never miss it
  // due to a tick being delayed by GC, etc.
  if (minutesNow < minutesTarget || minutesNow > minutesTarget + 15) return;

  inFlight = true;
  try {
    const res: PostMortemRunResult = await runPostMortem();
    lastRunDateStr = today;
    logger.info(
      {
        ranAt: res.ranAt,
        clusters: res.clustersAnalysed,
        lessons: res.lessonsCreated.length,
        deprecated: res.staleDeprecated.length,
        skippedReason: res.skippedReason,
      },
      '[post-mortem] nightly run complete',
    );
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : err },
      '[post-mortem] nightly run threw',
    );
    // Don't update lastRunDateStr — let next minute retry once
  } finally {
    inFlight = false;
  }
}

/**
 * Start the nightly scheduler. Idempotent — calling twice is a no-op.
 * Honors:
 *   ENABLE_POST_MORTEM=true   (master switch)
 *   POST_MORTEM_HOUR_ET=2     (override target hour)
 *   POST_MORTEM_MINUTE_ET=30  (override target minute)
 */
export function startPostMortemScheduler(): void {
  if (timer) return;
  if (process.env['ENABLE_POST_MORTEM'] !== 'true') {
    logger.info('[post-mortem] disabled (set ENABLE_POST_MORTEM=true to enable)');
    return;
  }
  const hour = parseInt(process.env['POST_MORTEM_HOUR_ET'] ?? String(DEFAULT_HOUR_ET), 10);
  const minute = parseInt(process.env['POST_MORTEM_MINUTE_ET'] ?? String(DEFAULT_MINUTE_ET), 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    logger.warn('[post-mortem] invalid hour/minute env — using defaults');
  }
  const targetHour = Number.isNaN(hour) ? DEFAULT_HOUR_ET : hour;
  const targetMinute = Number.isNaN(minute) ? DEFAULT_MINUTE_ET : minute;

  logger.info({ targetHour, targetMinute, tz: ET_TIMEZONE }, '[post-mortem] scheduler started');
  timer = setInterval(() => { void tick(targetHour, targetMinute); }, TICK_MS);
  // Also do an initial tick immediately to catch a same-day window we might be in
  void tick(targetHour, targetMinute);
}

export function stopPostMortemScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Test seam: reset scheduler state. */
export function _resetSchedulerForTests(): void {
  if (timer) clearInterval(timer);
  timer = null;
  lastRunDateStr = null;
  inFlight = false;
}
