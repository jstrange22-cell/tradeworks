import { getSetting, setSetting } from '@tradeworks/db';
import { createServiceLogger } from '../lib/logger.js';

const log = createServiceLogger('notification-service');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationChannelType = 'email' | 'discord' | 'telegram';

export interface NotificationChannel {
  type: NotificationChannelType;
  enabled: boolean;
  config: Record<string, string>;
}

export type NotificationEvent =
  | 'trade_executed'
  | 'circuit_breaker_triggered'
  | 'daily_pnl_summary'
  | 'whale_alert'
  | 'arbitrage_opportunity'
  | 'risk_alert';

export const NOTIFICATION_EVENTS: readonly NotificationEvent[] = [
  'trade_executed',
  'circuit_breaker_triggered',
  'daily_pnl_summary',
  'whale_alert',
  'arbitrage_opportunity',
  'risk_alert',
] as const;

export const EVENT_LABELS: Record<NotificationEvent, string> = {
  trade_executed: 'Trade Executed',
  circuit_breaker_triggered: 'Circuit Breaker Triggered',
  daily_pnl_summary: 'Daily P&L Summary',
  whale_alert: 'Whale Alert',
  arbitrage_opportunity: 'Arbitrage Opportunity',
  risk_alert: 'Risk Alert',
};

export interface NotificationPreferences {
  channels: NotificationChannel[];
  subscribedEvents: NotificationEvent[];
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  timestamp?: string;
}

interface TradeNotificationData {
  instrument: string;
  side: string;
  quantity: number;
  price: number;
  exchange?: string;
  strategyId?: string;
}

interface PnlSummaryData {
  date: string;
  totalPnl: number;
  winRate: number;
  tradeCount: number;
  bestTrade?: string;
  worstTrade?: string;
}

interface WhaleAlertData {
  wallet: string;
  token: string;
  amount: number;
  usdValue: number;
  direction: string;
}

interface RiskAlertData {
  type: string;
  message: string;
  severity: string;
  currentValue?: number;
  threshold?: number;
}

interface ArbitrageData {
  pair: string;
  exchangeA: string;
  exchangeB: string;
  spread: number;
  estimatedProfit: number;
}

interface CircuitBreakerData {
  reason: string;
  triggeredAt: string;
  metric: string;
  value: number;
  threshold: number;
}

// ---------------------------------------------------------------------------
// Settings key used in the userSettings table
// ---------------------------------------------------------------------------

const PREFERENCES_KEY = 'notification_preferences';

const DEFAULT_PREFERENCES: NotificationPreferences = {
  channels: [
    { type: 'discord', enabled: false, config: {} },
    { type: 'telegram', enabled: false, config: {} },
    { type: 'email', enabled: false, config: {} },
  ],
  subscribedEvents: ['trade_executed', 'circuit_breaker_triggered', 'risk_alert'],
};

// ---------------------------------------------------------------------------
// Preferences CRUD
// ---------------------------------------------------------------------------

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  try {
    const row = await getSetting(PREFERENCES_KEY);
    if (!row) {
      return { ...DEFAULT_PREFERENCES };
    }
    const stored = row.value as Record<string, unknown>;
    return {
      channels: (stored.channels as NotificationChannel[]) ?? DEFAULT_PREFERENCES.channels,
      subscribedEvents:
        (stored.subscribedEvents as NotificationEvent[]) ?? DEFAULT_PREFERENCES.subscribedEvents,
    };
  } catch (error) {
    log.warn({ error }, 'Failed to read notification preferences from DB, returning defaults');
    return { ...DEFAULT_PREFERENCES };
  }
}

export async function updateNotificationPreferences(
  prefs: NotificationPreferences,
): Promise<NotificationPreferences> {
  try {
    await setSetting(PREFERENCES_KEY, {
      channels: prefs.channels,
      subscribedEvents: prefs.subscribedEvents,
    });
    log.info('Notification preferences updated');
    return prefs;
  } catch (error) {
    log.error({ error }, 'Failed to save notification preferences');
    throw new Error('Failed to save notification preferences');
  }
}

// ---------------------------------------------------------------------------
// Channel senders
// ---------------------------------------------------------------------------

export async function sendDiscordWebhook(
  webhookUrl: string,
  message: string,
  embed?: DiscordEmbed,
): Promise<boolean> {
  try {
    const body: Record<string, unknown> = { content: message };
    if (embed) {
      body.embeds = [embed];
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => 'unknown');
      log.error({ status: response.status, body: text }, 'Discord webhook failed');
      return false;
    }

    log.info('Discord notification sent');
    return true;
  } catch (error) {
    log.error({ error }, 'Discord webhook request failed');
    return false;
  }
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  message: string,
): Promise<boolean> {
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => 'unknown');
      log.error({ status: response.status, body: text }, 'Telegram message failed');
      return false;
    }

    log.info('Telegram notification sent');
    return true;
  } catch (error) {
    log.error({ error }, 'Telegram request failed');
    return false;
  }
}

async function sendEmailNotification(
  toAddress: string,
  subject: string,
  body: string,
): Promise<boolean> {
  // Email sending is a stub — requires SMTP config or service like SendGrid/SES.
  // Log and return false so callers know it's not yet wired up.
  log.warn(
    { toAddress, subject, bodyLength: body.length },
    'Email notification channel not yet implemented — skipping',
  );
  return false;
}

// ---------------------------------------------------------------------------
// Channel dispatch (internal)
// ---------------------------------------------------------------------------

async function dispatchToChannel(
  channel: NotificationChannel,
  subject: string,
  message: string,
  embed?: DiscordEmbed,
): Promise<boolean> {
  switch (channel.type) {
    case 'discord': {
      const webhookUrl = channel.config.webhookUrl ?? '';
      if (!webhookUrl) {
        log.warn('Discord channel enabled but no webhookUrl configured');
        return false;
      }
      return sendDiscordWebhook(webhookUrl, message, embed);
    }

    case 'telegram': {
      const botToken = channel.config.botToken ?? '';
      const chatId = channel.config.chatId ?? '';
      if (!botToken || !chatId) {
        log.warn('Telegram channel enabled but missing botToken or chatId');
        return false;
      }
      return sendTelegramMessage(botToken, chatId, message);
    }

    case 'email': {
      const toAddress = channel.config.email ?? '';
      if (!toAddress) {
        log.warn('Email channel enabled but no email address configured');
        return false;
      }
      return sendEmailNotification(toAddress, subject, message);
    }

    default:
      log.warn({ type: channel.type }, 'Unknown notification channel type');
      return false;
  }
}

// ---------------------------------------------------------------------------
// Core send function
// ---------------------------------------------------------------------------

export async function sendNotification(
  event: NotificationEvent,
  data: Record<string, unknown>,
): Promise<{ sent: number; failed: number }> {
  const prefs = await getNotificationPreferences();

  // Check if user subscribed to this event
  if (!prefs.subscribedEvents.includes(event)) {
    log.info({ event }, 'User not subscribed to this event — skipping');
    return { sent: 0, failed: 0 };
  }

  const enabledChannels = prefs.channels.filter((ch) => ch.enabled);
  if (enabledChannels.length === 0) {
    log.info({ event }, 'No enabled channels — skipping notification');
    return { sent: 0, failed: 0 };
  }

  const { subject, message, embed } = formatNotificationPayload(event, data);

  let sent = 0;
  let failed = 0;

  const results = await Promise.allSettled(
    enabledChannels.map((channel) => dispatchToChannel(channel, subject, message, embed)),
  );

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      sent++;
    } else {
      failed++;
    }
  }

  log.info({ event, sent, failed }, 'Notification dispatch complete');
  return { sent, failed };
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

export function formatTradeNotification(trade: TradeNotificationData): string {
  const emoji = trade.side === 'buy' ? 'BUY' : 'SELL';
  const lines = [
    `[${emoji}] ${trade.instrument}`,
    `Side: ${trade.side.toUpperCase()}`,
    `Qty: ${trade.quantity}`,
    `Price: $${trade.price.toFixed(2)}`,
  ];
  if (trade.exchange) lines.push(`Exchange: ${trade.exchange}`);
  if (trade.strategyId) lines.push(`Strategy: ${trade.strategyId}`);
  return lines.join('\n');
}

export function formatPnlSummary(pnl: PnlSummaryData): string {
  const sign = pnl.totalPnl >= 0 ? '+' : '';
  const lines = [
    `Daily P&L Summary — ${pnl.date}`,
    `Total P&L: ${sign}$${pnl.totalPnl.toFixed(2)}`,
    `Win Rate: ${(pnl.winRate * 100).toFixed(1)}%`,
    `Trades: ${pnl.tradeCount}`,
  ];
  if (pnl.bestTrade) lines.push(`Best: ${pnl.bestTrade}`);
  if (pnl.worstTrade) lines.push(`Worst: ${pnl.worstTrade}`);
  return lines.join('\n');
}

export function formatWhaleAlert(whale: WhaleAlertData): string {
  return [
    `WHALE ALERT`,
    `Wallet: ${whale.wallet.slice(0, 8)}...${whale.wallet.slice(-4)}`,
    `Token: ${whale.token}`,
    `Amount: ${whale.amount.toLocaleString()}`,
    `Value: $${whale.usdValue.toLocaleString()}`,
    `Direction: ${whale.direction}`,
  ].join('\n');
}

export function formatRiskAlert(alert: RiskAlertData): string {
  const lines = [
    `RISK ALERT [${alert.severity.toUpperCase()}]`,
    `Type: ${alert.type}`,
    alert.message,
  ];
  if (alert.currentValue !== undefined && alert.threshold !== undefined) {
    lines.push(`Current: ${alert.currentValue} | Threshold: ${alert.threshold}`);
  }
  return lines.join('\n');
}

export function formatArbitrageOpportunity(arb: ArbitrageData): string {
  return [
    `ARBITRAGE OPPORTUNITY`,
    `Pair: ${arb.pair}`,
    `${arb.exchangeA} <-> ${arb.exchangeB}`,
    `Spread: ${arb.spread.toFixed(2)}%`,
    `Est. Profit: $${arb.estimatedProfit.toFixed(2)}`,
  ].join('\n');
}

export function formatCircuitBreaker(cb: CircuitBreakerData): string {
  return [
    `CIRCUIT BREAKER TRIGGERED`,
    `Reason: ${cb.reason}`,
    `Metric: ${cb.metric}`,
    `Value: ${cb.value} | Threshold: ${cb.threshold}`,
    `Triggered at: ${cb.triggeredAt}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Internal: build subject + message + optional embed for a given event
// ---------------------------------------------------------------------------

function formatNotificationPayload(
  event: NotificationEvent,
  data: Record<string, unknown>,
): { subject: string; message: string; embed?: DiscordEmbed } {
  const label = EVENT_LABELS[event];

  switch (event) {
    case 'trade_executed': {
      const message = formatTradeNotification(data as unknown as TradeNotificationData);
      return {
        subject: `TradeWorks — ${label}`,
        message,
        embed: {
          title: label,
          description: message,
          color: (data.side as string) === 'buy' ? 0x22c55e : 0xef4444,
          timestamp: new Date().toISOString(),
        },
      };
    }

    case 'circuit_breaker_triggered': {
      const message = formatCircuitBreaker(data as unknown as CircuitBreakerData);
      return {
        subject: `TradeWorks — ${label}`,
        message,
        embed: {
          title: label,
          description: message,
          color: 0xf59e0b,
          timestamp: new Date().toISOString(),
        },
      };
    }

    case 'daily_pnl_summary': {
      const message = formatPnlSummary(data as unknown as PnlSummaryData);
      const pnl = (data.totalPnl as number) ?? 0;
      return {
        subject: `TradeWorks — ${label}`,
        message,
        embed: {
          title: label,
          description: message,
          color: pnl >= 0 ? 0x22c55e : 0xef4444,
          timestamp: new Date().toISOString(),
        },
      };
    }

    case 'whale_alert': {
      const message = formatWhaleAlert(data as unknown as WhaleAlertData);
      return {
        subject: `TradeWorks — ${label}`,
        message,
        embed: {
          title: label,
          description: message,
          color: 0x3b82f6,
          timestamp: new Date().toISOString(),
        },
      };
    }

    case 'arbitrage_opportunity': {
      const message = formatArbitrageOpportunity(data as unknown as ArbitrageData);
      return {
        subject: `TradeWorks — ${label}`,
        message,
        embed: {
          title: label,
          description: message,
          color: 0xa855f7,
          timestamp: new Date().toISOString(),
        },
      };
    }

    case 'risk_alert': {
      const message = formatRiskAlert(data as unknown as RiskAlertData);
      return {
        subject: `TradeWorks — ${label}`,
        message,
        embed: {
          title: label,
          description: message,
          color: 0xef4444,
          timestamp: new Date().toISOString(),
        },
      };
    }

    default: {
      const _exhaustive: never = event;
      return {
        subject: `TradeWorks Notification`,
        message: JSON.stringify(_exhaustive),
      };
    }
  }
}
