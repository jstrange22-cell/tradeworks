/**
 * Twitter/X Auto-Poster — Posts tweets via X API v2 Free Tier
 *
 * Free tier: 500 tweets/month (~16/day)
 * Used by Token Factory to auto-promote launched tokens.
 *
 * Env vars needed:
 *   X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET
 */

import { TwitterApi } from 'twitter-api-v2';
import { logger } from '../lib/logger.js';

// ── Config ───────────────────────────────────────────────────────────────

const MONTHLY_LIMIT = 500;  // Free tier
const DAILY_LIMIT = 16;     // Stay safe under monthly cap

// ── State ────────────────────────────────────────────────────────────────

let client: TwitterApi | null = null;
let monthlyCount = 0;
let dailyCount = 0;
let monthResetDate = new Date().toISOString().slice(0, 7); // YYYY-MM
let dailyResetDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
let lastTweetAt: string | null = null;
let totalPosted = 0;
let totalFailed = 0;

// ── Initialize ───────────────────────────────────────────────────────────

function getClient(): TwitterApi | null {
  if (client) return client;

  const apiKey = process.env.X_API_KEY;
  const apiSecret = process.env.X_API_SECRET;
  const accessToken = process.env.X_ACCESS_TOKEN;
  const accessSecret = process.env.X_ACCESS_SECRET;

  if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
    return null;
  }

  client = new TwitterApi({
    appKey: apiKey,
    appSecret: apiSecret,
    accessToken,
    accessSecret,
  });

  logger.info('[Twitter] X API client initialized (Free tier: 500 tweets/month)');
  return client;
}

// ── Post Tweet ───────────────────────────────────────────────────────────

export interface TweetResult {
  success: boolean;
  tweetId?: string;
  tweetUrl?: string;
  error?: string;
  remaining: { daily: number; monthly: number };
}

export async function postTweet(text: string): Promise<TweetResult> {
  // Reset counters
  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  const currentDay = now.toISOString().slice(0, 10);

  if (currentMonth !== monthResetDate) {
    monthlyCount = 0;
    monthResetDate = currentMonth;
  }
  if (currentDay !== dailyResetDate) {
    dailyCount = 0;
    dailyResetDate = currentDay;
  }

  // Check limits
  if (monthlyCount >= MONTHLY_LIMIT) {
    return {
      success: false,
      error: `Monthly tweet limit reached (${MONTHLY_LIMIT}). Resets next month.`,
      remaining: { daily: 0, monthly: 0 },
    };
  }
  if (dailyCount >= DAILY_LIMIT) {
    return {
      success: false,
      error: `Daily tweet limit reached (${DAILY_LIMIT}). Resets tomorrow.`,
      remaining: { daily: 0, monthly: MONTHLY_LIMIT - monthlyCount },
    };
  }

  // Truncate to 280 chars
  if (text.length > 280) {
    text = text.slice(0, 277) + '...';
  }

  const twitterClient = getClient();
  if (!twitterClient) {
    // No credentials — log as paper tweet
    logger.info({ text: text.slice(0, 50) }, `[Twitter] PAPER TWEET (no credentials): ${text.slice(0, 80)}...`);
    return {
      success: true,
      tweetId: `paper_${Date.now()}`,
      error: 'No X API credentials configured — tweet logged but not posted',
      remaining: { daily: DAILY_LIMIT - dailyCount, monthly: MONTHLY_LIMIT - monthlyCount },
    };
  }

  try {
    const result = await twitterClient.v2.tweet(text);
    monthlyCount++;
    dailyCount++;
    totalPosted++;
    lastTweetAt = now.toISOString();

    const tweetId = result.data.id;
    logger.info({ tweetId, daily: dailyCount, monthly: monthlyCount },
      `[Twitter] Posted tweet ${tweetId} (${dailyCount}/${DAILY_LIMIT} today, ${monthlyCount}/${MONTHLY_LIMIT} month)`);

    return {
      success: true,
      tweetId,
      tweetUrl: `https://x.com/i/status/${tweetId}`,
      remaining: { daily: DAILY_LIMIT - dailyCount, monthly: MONTHLY_LIMIT - monthlyCount },
    };
  } catch (err: unknown) {
    totalFailed++;
    const message = err instanceof Error ? err.message : String(err);

    // Rate limit handling
    if (message.includes('429') || message.toLowerCase().includes('rate limit')) {
      logger.warn('[Twitter] Rate limited by X API. Will retry on next cycle.');
      return {
        success: false,
        error: 'Rate limited — will retry next cycle',
        remaining: { daily: DAILY_LIMIT - dailyCount, monthly: MONTHLY_LIMIT - monthlyCount },
      };
    }

    // Queue for retry on 503/5xx errors ONLY (not 403 which means suspended/forbidden)
    // Cap queue at 50 to prevent memory leaks
    if ((message.includes('503') || message.includes('500') || message.includes('502')) && tweetRetryQueue.length < 50) {
      tweetRetryQueue.push({ text, attempts: 1, lastAttempt: Date.now() });
      logger.warn({ queueSize: tweetRetryQueue.length }, `[Twitter] X API down (${message.slice(0, 30)}). Queued for retry.`);
    }

    logger.error({ err: message }, `[Twitter] Tweet failed: ${message}`);
    return {
      success: false,
      error: message,
      remaining: { daily: DAILY_LIMIT - dailyCount, monthly: MONTHLY_LIMIT - monthlyCount },
    };
  }
}

// ── Retry Queue ─────────────────────────────────────────────────────────

interface QueuedTweet { text: string; attempts: number; lastAttempt: number; }
const tweetRetryQueue: QueuedTweet[] = [];
const MAX_RETRY_ATTEMPTS = 5;

// Retry failed tweets every 5 minutes
setInterval(async () => {
  if (tweetRetryQueue.length === 0) return;
  const now = Date.now();
  for (let i = tweetRetryQueue.length - 1; i >= 0; i--) {
    const queued = tweetRetryQueue[i];
    if (now - queued.lastAttempt < 300_000) continue; // Wait 5 min between retries
    if (queued.attempts >= MAX_RETRY_ATTEMPTS) {
      logger.warn({ text: queued.text.slice(0, 40) }, '[Twitter] Max retries reached, dropping tweet');
      tweetRetryQueue.splice(i, 1);
      continue;
    }
    queued.attempts++;
    queued.lastAttempt = now;
    const result = await postTweet(queued.text);
    if (result.success) {
      tweetRetryQueue.splice(i, 1);
      logger.info(`[Twitter] Retry succeeded after ${queued.attempts} attempts`);
    }
  }
}, 300_000);

// ── Token Promotion Tweets ───────────────────────────────────────────────

export async function tweetTokenLaunch(ticker: string, _name: string, mint: string, hook: string): Promise<TweetResult> {
  const pumpLink = `https://pump.fun/coin/${mint}`;
  const text = `$${ticker} just launched on pump.fun\n\n${hook}\n\n${pumpLink}\n\n#Solana #PumpFun`;
  return postTweet(text);
}

export async function tweetMilestone(ticker: string, curvePct: number, holders: number, mint: string): Promise<TweetResult> {
  const pumpLink = `https://pump.fun/coin/${mint}`;
  void pumpLink; // Used in text
  const text = `$${ticker} bonding curve at ${curvePct}%! ${holders} holders and growing.\n\nMomentum building. LFG!\n\nhttps://pump.fun/coin/${mint}`;
  return postTweet(text);
}

export async function tweetGraduation(ticker: string, _mint: string): Promise<TweetResult> {
  const text = `$${ticker} just GRADUATED to PumpSwap!\n\nLP burned. Community-driven.\nCreator revenue is LIVE (0.95% of all volume).\n\nThis is just the beginning.`;
  return postTweet(text);
}

// ── Status ───────────────────────────────────────────────────────────────

export function getTwitterStatus() {
  return {
    configured: Boolean(process.env.X_API_KEY && process.env.X_ACCESS_TOKEN),
    dailyCount,
    dailyLimit: DAILY_LIMIT,
    monthlyCount,
    monthlyLimit: MONTHLY_LIMIT,
    remainingToday: DAILY_LIMIT - dailyCount,
    remainingMonth: MONTHLY_LIMIT - monthlyCount,
    totalPosted,
    totalFailed,
    lastTweetAt,
  };
}
