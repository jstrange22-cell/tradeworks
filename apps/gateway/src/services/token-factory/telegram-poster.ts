/**
 * Telegram Auto-Poster — Posts token launches to Telegram groups
 *
 * Broadcasts new token launches and milestone updates to configured
 * Telegram groups via the Bot API.
 *
 * Env vars needed:
 *   TELEGRAM_BOT_TOKEN    — Bot token from @BotFather
 *   TELEGRAM_GROUP_IDS    — Comma-separated chat IDs (e.g., "-100123456,-100789012")
 */

import { logger } from '../../lib/logger.js';

// ── Types ────────────────────────────────────────────────────────────────

export interface LaunchInfo {
  mint: string;
  name: string;
  ticker: string;
  hook: string;
  imageUri?: string;
  pumpFunUrl: string;
  category: string;
}

interface PostedMessage {
  chatId: string;
  messageId: number;
}

interface TelegramApiResponse {
  ok: boolean;
  result?: { message_id: number };
  description?: string;
  parameters?: { retry_after?: number };
}

export interface TelegramPostResult {
  success: boolean;
  postedTo: number;
  failedTo: number;
  paperMode: boolean;
  error?: string;
}

export interface TelegramStatus {
  configured: boolean;
  paperMode: boolean;
  groupCount: number;
  totalPosted: number;
  totalFailed: number;
  totalUpdated: number;
  trackedTokens: number;
  lastPostAt: string | null;
}

// ── Config ───────────────────────────────────────────────────────────────

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const RATE_LIMIT_MS = 30_000; // 1 message per group per 30 seconds
const MAX_BACKOFF_MS = 60_000;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_RETRY_ATTEMPTS = 5;

// ── State ────────────────────────────────────────────────────────────────

/** mint -> array of posted messages across groups */
const postedMessages = new Map<string, PostedMessage[]>();

/** mint -> cached LaunchInfo for milestone message rebuilds */
const tokenInfoCache = new Map<string, LaunchInfo>();

/** chatId -> last post timestamp (rate limiter) */
const lastPostPerGroup = new Map<string, number>();

let totalPosted = 0;
let totalFailed = 0;
let totalUpdated = 0;
let lastPostAt: string | null = null;

// ── Helpers ──────────────────────────────────────────────────────────────

function getBotToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN ?? null;
}
function getGroupIds(): string[] {
  const raw = process.env.TELEGRAM_GROUP_IDS;
  if (!raw) return [];
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

function isPaperMode(): boolean {
  return !getBotToken();
}

export function progressBar(pct: number): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round(clamped / 10);
  return '\u2593'.repeat(filled) + '\u2591'.repeat(10 - filled) + ` ${clamped.toFixed(0)}%`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function formatLaunchMessage(token: LaunchInfo): string {
  return [
    `\u{1F680} NEW LAUNCH: $${token.ticker}`,
    '',
    token.hook,
    '',
    `\u{1F4CA} Category: ${token.category}`,
    `\u{1F4C8} Curve: ${progressBar(0)}`,
    `\u{1F465} Holders: 0`,
    '',
    `\u{1F517} Buy: ${token.pumpFunUrl}`,
    `\u{1F4CB} CA: ${token.mint}`,
    '',
    `#Solana #PumpFun #${token.ticker}`,
  ].join('\n');
}

function formatMilestoneMessage(
  token: LaunchInfo,
  curvePct: number,
  holders: number,
): string {
  return [
    `\u{1F680} NEW LAUNCH: $${token.ticker}`,
    '',
    token.hook,
    '',
    `\u{1F4CA} Category: ${token.category}`,
    `\u{1F4C8} Curve: ${progressBar(curvePct)}`,
    `\u{1F465} Holders: ${holders}`,
    '',
    `\u{1F517} Buy: ${token.pumpFunUrl}`,
    `\u{1F4CB} CA: ${token.mint}`,
    '',
    `#Solana #PumpFun #${token.ticker}`,
  ].join('\n');
}
/** Wait for per-group rate limit window */
async function waitForRateLimit(chatId: string): Promise<void> {
  const lastPost = lastPostPerGroup.get(chatId);
  if (!lastPost) return;

  const elapsed = Date.now() - lastPost;
  if (elapsed < RATE_LIMIT_MS) {
    const waitMs = RATE_LIMIT_MS - elapsed;
    logger.debug({ chatId, waitMs }, '[Telegram] Rate limit wait');
    await sleep(waitMs);
  }
}

// ── Telegram API Calls ──────────────────────────────────────────────────

async function callTelegramApi(
  method: string,
  body: Record<string, unknown>,
  retryCount = 0,
): Promise<TelegramApiResponse> {
  const token = getBotToken();
  if (!token) {
    return { ok: false, description: 'No bot token configured' };
  }

  const url = `${TELEGRAM_API_BASE}/bot${token}/${method}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = (await response.json()) as TelegramApiResponse;

    // Handle 429 rate limit with exponential backoff
    if (response.status === 429) {
      const retryAfter = data.parameters?.retry_after ?? 5;
      const backoffMs = Math.min(
        INITIAL_BACKOFF_MS * Math.pow(2, retryCount),
        MAX_BACKOFF_MS,
      );
      const waitMs = Math.max(retryAfter * 1000, backoffMs);

      if (retryCount < MAX_RETRY_ATTEMPTS) {
        logger.warn(
          { method, retryAfter, retryCount, waitMs },
          `[Telegram] Rate limited (429). Backing off ${waitMs}ms (attempt ${retryCount + 1}/${MAX_RETRY_ATTEMPTS})`,
        );
        await sleep(waitMs);
        return callTelegramApi(method, body, retryCount + 1);
      }

      logger.error('[Telegram] Max retries exceeded for rate limit');
      return { ok: false, description: `Rate limited after ${retryCount} retries` };
    }
    if (!data.ok) {
      logger.warn(
        { method, description: data.description },
        `[Telegram] API error: ${data.description}`,
      );
    }

    return data;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ method, err: message }, `[Telegram] Request failed: ${message}`);
    return { ok: false, description: message };
  }
}

async function sendMessage(chatId: string, text: string): Promise<number | null> {
  await waitForRateLimit(chatId);

  const data = await callTelegramApi('sendMessage', {
    chat_id: chatId,
    text,
    disable_web_page_preview: false,
  });

  if (data.ok && data.result) {
    lastPostPerGroup.set(chatId, Date.now());
    return data.result.message_id;
  }

  return null;
}
async function editMessage(
  chatId: string,
  messageId: number,
  text: string,
): Promise<boolean> {
  const data = await callTelegramApi('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    disable_web_page_preview: false,
  });

  return data.ok;
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Post a new token launch to all configured Telegram groups.
 * In paper mode (no bot token), logs the message without sending.
 */
export async function postTokenLaunch(token: LaunchInfo): Promise<TelegramPostResult> {
  const groups = getGroupIds();
  const message = formatLaunchMessage(token);

  // Cache token info for milestone updates
  tokenInfoCache.set(token.mint, token);
  if (isPaperMode()) {
    logger.info(
      { mint: token.mint, ticker: token.ticker, groups: groups.length },
      `[Telegram] PAPER POST (no bot token): $${token.ticker} launch logged`,
    );
    // Track in paper mode so milestone updates can reference them
    postedMessages.set(
      token.mint,
      (groups.length > 0 ? groups : ['paper-group']).map((chatId) => ({
        chatId,
        messageId: -1,
      })),
    );
    return {
      success: true,
      postedTo: groups.length || 1,
      failedTo: 0,
      paperMode: true,
    };
  }

  if (groups.length === 0) {
    logger.warn('[Telegram] No group IDs configured (TELEGRAM_GROUP_IDS)');
    return {
      success: false,
      postedTo: 0,
      failedTo: 0,
      paperMode: false,
      error: 'No TELEGRAM_GROUP_IDS configured',
    };
  }
  const posted: PostedMessage[] = [];
  let failedCount = 0;

  for (const chatId of groups) {
    const messageId = await sendMessage(chatId, message);
    if (messageId !== null) {
      posted.push({ chatId, messageId });
      totalPosted++;
    } else {
      failedCount++;
      totalFailed++;
    }
  }

  if (posted.length > 0) {
    postedMessages.set(token.mint, posted);
    lastPostAt = new Date().toISOString();
  }

  logger.info(
    {
      mint: token.mint,
      ticker: token.ticker,
      posted: posted.length,
      failed: failedCount,
    },
    `[Telegram] $${token.ticker} launch posted to ${posted.length}/${groups.length} groups`,
  );

  return {
    success: posted.length > 0,
    postedTo: posted.length,
    failedTo: failedCount,
    paperMode: false,
  };
}
/**
 * Edit existing launch messages with milestone updates (curve %, holders).
 * Only updates groups where the original message was successfully posted.
 */
export async function updateTokenMilestone(
  mint: string,
  curvePct: number,
  holders: number,
): Promise<{ updated: number; failed: number }> {
  const messages = postedMessages.get(mint);
  if (!messages || messages.length === 0) {
    logger.debug({ mint }, '[Telegram] No tracked messages for milestone update');
    return { updated: 0, failed: 0 };
  }

  const tokenInfo = tokenInfoCache.get(mint);

  // Build the updated message text
  const text = tokenInfo
    ? formatMilestoneMessage(tokenInfo, curvePct, holders)
    : [
        `\u{1F4C8} Curve: ${progressBar(curvePct)}`,
        `\u{1F465} Holders: ${holders}`,
        '',
        `\u{1F517} https://pump.fun/coin/${mint}`,
        `\u{1F4CB} CA: ${mint}`,
      ].join('\n');
  if (isPaperMode()) {
    logger.info(
      { mint: mint.slice(0, 8), curvePct, holders },
      `[Telegram] PAPER UPDATE: ${mint.slice(0, 8)}... curve=${curvePct}% holders=${holders}`,
    );
    return { updated: messages.length, failed: 0 };
  }

  let updated = 0;
  let failed = 0;

  for (const { chatId, messageId } of messages) {
    if (messageId === -1) continue; // Paper mode sentinel
    const ok = await editMessage(chatId, messageId, text);
    if (ok) {
      updated++;
      totalUpdated++;
    } else {
      failed++;
    }
  }

  logger.info(
    { mint: mint.slice(0, 8), curvePct, holders, updated, failed },
    `[Telegram] Milestone update: ${updated} edited, ${failed} failed`,
  );

  return { updated, failed };
}
/**
 * Return posting stats for the Telegram poster.
 */
export function getTelegramStatus(): TelegramStatus {
  return {
    configured: Boolean(getBotToken()),
    paperMode: isPaperMode(),
    groupCount: getGroupIds().length,
    totalPosted,
    totalFailed,
    totalUpdated,
    trackedTokens: postedMessages.size,
    lastPostAt,
  };
}
