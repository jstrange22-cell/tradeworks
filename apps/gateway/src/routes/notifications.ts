import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  sendDiscordWebhook,
  sendTelegramMessage,
  NOTIFICATION_EVENTS,
  type NotificationChannelType,
  type NotificationEvent,
  type NotificationChannel,
} from '../services/notification-service.js';
import { createServiceLogger } from '../lib/logger.js';

const log = createServiceLogger('notifications-route');

/**
 * Notification routes.
 * GET    /api/v1/notifications/preferences  - Get notification preferences
 * PUT    /api/v1/notifications/preferences  - Update notification preferences
 * POST   /api/v1/notifications/test         - Send a test notification
 */

export const notificationsRouter: RouterType = Router();

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const ChannelTypeSchema = z.enum(['email', 'discord', 'telegram']);

const NotificationEventSchema = z.enum([
  'trade_executed',
  'circuit_breaker_triggered',
  'daily_pnl_summary',
  'whale_alert',
  'arbitrage_opportunity',
  'risk_alert',
]);

const ChannelSchema = z.object({
  type: ChannelTypeSchema,
  enabled: z.boolean(),
  config: z.record(z.string(), z.string()),
});

const UpdatePreferencesSchema = z.object({
  channels: z.array(ChannelSchema).min(1).max(10),
  subscribedEvents: z.array(NotificationEventSchema).min(0).max(NOTIFICATION_EVENTS.length),
});

const TestNotificationSchema = z.object({
  channelType: ChannelTypeSchema,
  config: z.record(z.string(), z.string()),
});

// ---------------------------------------------------------------------------
// GET /preferences — read current notification preferences
// ---------------------------------------------------------------------------

notificationsRouter.get('/preferences', async (_req, res) => {
  try {
    const prefs = await getNotificationPreferences();
    res.json({ data: prefs });
  } catch (error) {
    log.error({ error }, 'Failed to get notification preferences');
    res.status(500).json({ error: 'Failed to fetch notification preferences' });
  }
});

// ---------------------------------------------------------------------------
// PUT /preferences — update notification preferences
// ---------------------------------------------------------------------------

notificationsRouter.put('/preferences', async (req, res) => {
  try {
    const body = UpdatePreferencesSchema.parse(req.body);

    const prefs = await updateNotificationPreferences({
      channels: body.channels as NotificationChannel[],
      subscribedEvents: body.subscribedEvents as NotificationEvent[],
    });

    res.json({ data: prefs, message: 'Notification preferences updated' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'Invalid notification preferences',
        details: error.errors,
      });
      return;
    }
    log.error({ error }, 'Failed to update notification preferences');
    res.status(500).json({ error: 'Failed to update notification preferences' });
  }
});

// ---------------------------------------------------------------------------
// POST /test — send a test notification to a single channel
// ---------------------------------------------------------------------------

notificationsRouter.post('/test', async (req, res) => {
  try {
    const body = TestNotificationSchema.parse(req.body);
    const { channelType, config } = body;

    const testMessage = `TradeWorks Test Notification\nChannel: ${channelType}\nTime: ${new Date().toISOString()}\nIf you see this, your ${channelType} notifications are working!`;
    const testEmbed = {
      title: 'TradeWorks Test',
      description: 'Your notification channel is connected and working.',
      color: 0x22c55e,
      timestamp: new Date().toISOString(),
      footer: { text: 'TradeWorks Notification System' },
    };

    let success = false;
    let detail = '';

    switch (channelType as NotificationChannelType) {
      case 'discord': {
        const webhookUrl = config.webhookUrl ?? '';
        if (!webhookUrl) {
          res.status(400).json({ error: 'Missing webhookUrl in config' });
          return;
        }
        success = await sendDiscordWebhook(webhookUrl, testMessage, testEmbed);
        detail = success ? 'Discord webhook received the test message' : 'Discord webhook failed';
        break;
      }

      case 'telegram': {
        const botToken = config.botToken ?? '';
        const chatId = config.chatId ?? '';
        if (!botToken || !chatId) {
          res.status(400).json({ error: 'Missing botToken or chatId in config' });
          return;
        }
        success = await sendTelegramMessage(botToken, chatId, testMessage);
        detail = success ? 'Telegram message sent successfully' : 'Telegram message failed';
        break;
      }

      case 'email': {
        const email = config.email ?? '';
        if (!email) {
          res.status(400).json({ error: 'Missing email in config' });
          return;
        }
        detail = 'Email channel not yet implemented — configure Discord or Telegram for now';
        success = false;
        break;
      }

      default: {
        res.status(400).json({ error: `Unknown channel type: ${channelType as string}` });
        return;
      }
    }

    res.json({
      data: { success, channelType, detail },
      message: success ? 'Test notification sent' : 'Test notification failed',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'Invalid test request',
        details: error.errors,
      });
      return;
    }
    log.error({ error }, 'Failed to send test notification');
    res.status(500).json({ error: 'Failed to send test notification' });
  }
});
