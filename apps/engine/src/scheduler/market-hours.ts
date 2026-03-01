/**
 * Market hours awareness module.
 * Provides functions to check market sessions across different asset classes.
 */

export type Market = 'us_equities' | 'crypto' | 'polymarket' | 'forex' | 'futures';

export type SessionType =
  | 'pre_market'
  | 'regular'
  | 'after_hours'
  | 'closed'
  | 'always_open';

export interface MarketSchedule {
  market: Market;
  timezone: string;
  sessions: {
    preMarket?: { start: string; end: string }; // HH:MM in market timezone
    regular: { start: string; end: string };
    afterHours?: { start: string; end: string };
  };
  closedDays: number[]; // Day of week (0=Sunday, 6=Saturday)
  holidays: string[]; // ISO date strings (YYYY-MM-DD)
}

const MARKET_SCHEDULES: Record<Market, MarketSchedule> = {
  us_equities: {
    market: 'us_equities',
    timezone: 'America/New_York',
    sessions: {
      preMarket: { start: '04:00', end: '09:30' },
      regular: { start: '09:30', end: '16:00' },
      afterHours: { start: '16:00', end: '20:00' },
    },
    closedDays: [0, 6], // Sunday, Saturday
    holidays: [
      // 2025 US market holidays (example)
      '2025-01-01', '2025-01-20', '2025-02-17',
      '2025-04-18', '2025-05-26', '2025-06-19',
      '2025-07-04', '2025-09-01', '2025-11-27',
      '2025-12-25',
    ],
  },

  crypto: {
    market: 'crypto',
    timezone: 'UTC',
    sessions: {
      regular: { start: '00:00', end: '23:59' },
    },
    closedDays: [], // Never closed
    holidays: [],
  },

  polymarket: {
    market: 'polymarket',
    timezone: 'UTC',
    sessions: {
      regular: { start: '00:00', end: '23:59' },
    },
    closedDays: [],
    holidays: [],
  },

  forex: {
    market: 'forex',
    timezone: 'UTC',
    sessions: {
      regular: { start: '17:00', end: '17:00' }, // Sunday 5 PM - Friday 5 PM ET (24h)
    },
    closedDays: [6], // Saturday (partial - closes Friday 5 PM ET)
    holidays: ['2025-12-25'],
  },

  futures: {
    market: 'futures',
    timezone: 'America/Chicago',
    sessions: {
      regular: { start: '17:00', end: '16:00' }, // Sunday-Friday, nearly 24h
    },
    closedDays: [6], // Saturday
    holidays: [],
  },
};

/**
 * Check if a specific market is currently open for trading.
 */
export function isMarketOpen(market: Market): boolean {
  const session = getMarketSession(market);
  return session !== 'closed';
}

/**
 * Get the next market open time for a given market.
 */
export function getNextOpen(market: Market): Date {
  const schedule = MARKET_SCHEDULES[market];

  if (!schedule) {
    throw new Error(`Unknown market: ${market}`);
  }

  // For 24/7 markets, they're always open
  if (schedule.closedDays.length === 0 && schedule.holidays.length === 0) {
    return new Date(); // Already open
  }

  const now = new Date();

  // Check each day going forward (up to 7 days)
  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    const checkDate = new Date(now);
    checkDate.setDate(checkDate.getDate() + dayOffset);

    const dayOfWeek = checkDate.getDay();
    const dateStr = checkDate.toISOString().slice(0, 10);

    // Skip closed days
    if (schedule.closedDays.includes(dayOfWeek)) continue;

    // Skip holidays
    if (schedule.holidays.includes(dateStr)) continue;

    // Parse regular session start time
    const [hours, minutes] = schedule.sessions.regular.start.split(':').map(Number);

    const openTime = new Date(checkDate);
    openTime.setUTCHours(hours ?? 0, minutes ?? 0, 0, 0);

    // Adjust for timezone offset (simplified - would use proper tz library in production)
    if (schedule.timezone === 'America/New_York') {
      openTime.setUTCHours(openTime.getUTCHours() + 5); // EST offset (simplified)
    } else if (schedule.timezone === 'America/Chicago') {
      openTime.setUTCHours(openTime.getUTCHours() + 6); // CST offset (simplified)
    }

    if (openTime > now) {
      return openTime;
    }
  }

  // Fallback: return tomorrow
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setUTCHours(14, 30, 0, 0); // Default to 9:30 AM ET
  return tomorrow;
}

/**
 * Get the current market session type for a given market.
 */
export function getMarketSession(market: Market): SessionType {
  const schedule = MARKET_SCHEDULES[market];

  if (!schedule) {
    throw new Error(`Unknown market: ${market}`);
  }

  // 24/7 markets
  if (market === 'crypto' || market === 'polymarket') {
    return 'always_open';
  }

  const now = new Date();
  const dayOfWeek = now.getDay();
  const dateStr = now.toISOString().slice(0, 10);

  // Check if market is closed today
  if (schedule.closedDays.includes(dayOfWeek)) {
    return 'closed';
  }
  if (schedule.holidays.includes(dateStr)) {
    return 'closed';
  }

  // Get current time in market timezone (simplified UTC offset)
  let marketHour = now.getUTCHours();
  let marketMinute = now.getUTCMinutes();

  if (schedule.timezone === 'America/New_York') {
    marketHour -= 5; // EST (simplified, doesn't account for DST)
    if (marketHour < 0) marketHour += 24;
  } else if (schedule.timezone === 'America/Chicago') {
    marketHour -= 6;
    if (marketHour < 0) marketHour += 24;
  }

  const currentMinutes = marketHour * 60 + marketMinute;

  // Check pre-market
  if (schedule.sessions.preMarket) {
    const preStart = parseTimeToMinutes(schedule.sessions.preMarket.start);
    const preEnd = parseTimeToMinutes(schedule.sessions.preMarket.end);
    if (currentMinutes >= preStart && currentMinutes < preEnd) {
      return 'pre_market';
    }
  }

  // Check regular session
  const regStart = parseTimeToMinutes(schedule.sessions.regular.start);
  const regEnd = parseTimeToMinutes(schedule.sessions.regular.end);
  if (currentMinutes >= regStart && currentMinutes < regEnd) {
    return 'regular';
  }

  // Check after-hours
  if (schedule.sessions.afterHours) {
    const ahStart = parseTimeToMinutes(schedule.sessions.afterHours.start);
    const ahEnd = parseTimeToMinutes(schedule.sessions.afterHours.end);
    if (currentMinutes >= ahStart && currentMinutes < ahEnd) {
      return 'after_hours';
    }
  }

  return 'closed';
}

/**
 * Determine the appropriate market for an instrument.
 */
export function getMarketForInstrument(instrument: string): Market {
  const upper = instrument.toUpperCase();

  // Crypto instruments
  const cryptoPatterns = [
    'BTC', 'ETH', 'SOL', 'AVAX', 'MATIC', 'DOGE', 'LINK',
    'UNI', 'AAVE', 'ADA', 'DOT', 'ATOM', 'NEAR', 'ARB',
  ];
  if (cryptoPatterns.some((p) => upper.includes(p))) {
    return 'crypto';
  }

  // Prediction markets
  if (upper.startsWith('0X') || upper.includes('POLYMARKET')) {
    return 'polymarket';
  }

  // Forex
  const forexPairs = ['EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'NZD'];
  if (forexPairs.some((p) => upper.includes(p)) && upper.includes('/')) {
    return 'forex';
  }

  // Futures
  if (upper.startsWith('/') || upper.includes('_FUT')) {
    return 'futures';
  }

  // Default to US equities
  return 'us_equities';
}

function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}
