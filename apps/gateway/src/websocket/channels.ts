import { WebSocket } from 'ws';
import type { AuthenticatedWebSocket } from './server.js';

/**
 * WebSocket channel definitions and subscription management.
 */

export interface ChannelDefinition {
  description: string;
  rateLimit: number; // Max messages per second
  requiresRole?: ('admin' | 'trader' | 'viewer')[];
}

/**
 * Available WebSocket channels.
 */
export const CHANNELS = {
  'portfolio:updates': {
    description: 'Real-time portfolio value, equity, and P&L updates',
    rateLimit: 2,
  },
  'trades:live': {
    description: 'Live trade execution notifications',
    rateLimit: 10,
  },
  'agents:logs': {
    description: 'Real-time agent activity logs and cycle updates',
    rateLimit: 5,
    requiresRole: ['admin', 'trader'],
  },
  'risk:metrics': {
    description: 'Real-time risk metrics, portfolio heat, and circuit breaker status',
    rateLimit: 1,
  },
  'solana:tokens': {
    description: 'New Solana token launches and pump.fun detections',
    rateLimit: 10,
  },
  'solana:whales': {
    description: 'Whale wallet activity and large transaction alerts',
    rateLimit: 5,
  },
  'solana:sniper': {
    description: 'Snipe bot execution status and trade results',
    rateLimit: 10,
    requiresRole: ['admin', 'trader'],
  },
  'tradingview:alerts': {
    description: 'Real-time buy/sell signals forwarded from TradingView webhook alerts',
    rateLimit: 10,
  },
} as const satisfies Record<string, ChannelDefinition>;

export type ChannelName = keyof typeof CHANNELS;

/**
 * Channel subscription manager.
 * Handles subscribe/unsubscribe and broadcasting to channel subscribers.
 */
export class ChannelManager {
  private subscriptions: Map<ChannelName, Set<AuthenticatedWebSocket>> = new Map();
  private messageCounts: Map<ChannelName, { count: number; resetAt: number }> = new Map();

  constructor() {
    // Initialize all channels
    for (const channel of Object.keys(CHANNELS) as ChannelName[]) {
      this.subscriptions.set(channel, new Set());
      this.messageCounts.set(channel, { count: 0, resetAt: Date.now() + 1000 });
    }
  }

  /**
   * Subscribe a WebSocket client to a channel.
   */
  subscribe(channel: ChannelName, ws: AuthenticatedWebSocket): boolean {
    const channelDef = CHANNELS[channel];

    // Check role requirements
    if ('requiresRole' in channelDef && channelDef.requiresRole && ws.user) {
      const allowed = (channelDef.requiresRole as readonly string[]).includes(ws.user.role);
      if (!allowed) {
        this.sendToClient(ws, {
          type: 'error',
          message: `Insufficient permissions for channel: ${channel}`,
        });
        return false;
      }
    }

    const subscribers = this.subscriptions.get(channel);
    if (subscribers) {
      subscribers.add(ws);
      console.log(
        `[Channels] ${ws.user?.email ?? 'unknown'} subscribed to ${channel} (${subscribers.size} subscribers)`,
      );
      return true;
    }
    return false;
  }

  /**
   * Unsubscribe a WebSocket client from a channel.
   */
  unsubscribe(channel: ChannelName, ws: AuthenticatedWebSocket): void {
    const subscribers = this.subscriptions.get(channel);
    if (subscribers) {
      subscribers.delete(ws);
      console.log(
        `[Channels] ${ws.user?.email ?? 'unknown'} unsubscribed from ${channel} (${subscribers.size} subscribers)`,
      );
    }
  }

  /**
   * Broadcast a message to all subscribers of a channel.
   */
  broadcast(channel: ChannelName, data: unknown): void {
    // Check rate limit
    if (!this.checkRateLimit(channel)) {
      return;
    }

    const subscribers = this.subscriptions.get(channel);
    if (!subscribers || subscribers.size === 0) return;

    const message = JSON.stringify({
      channel,
      timestamp: Date.now(),
      data,
    });

    let sent = 0;
    let failed = 0;

    for (const ws of subscribers) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(message);
          sent++;
        } catch {
          failed++;
        }
      }
    }

    if (sent > 0) {
      console.log(`[Channels] Broadcast to ${channel}: ${sent} delivered, ${failed} failed`);
    }
  }

  /**
   * Get the number of subscribers for a channel.
   */
  getSubscriberCount(channel: ChannelName): number {
    return this.subscriptions.get(channel)?.size ?? 0;
  }

  /**
   * Get subscriber counts for all channels.
   */
  getAllSubscriberCounts(): Record<ChannelName, number> {
    const counts: Partial<Record<ChannelName, number>> = {};
    for (const [channel, subscribers] of this.subscriptions) {
      counts[channel] = subscribers.size;
    }
    return counts as Record<ChannelName, number>;
  }

  /**
   * Check and enforce per-channel rate limiting.
   */
  private checkRateLimit(channel: ChannelName): boolean {
    const channelDef = CHANNELS[channel];
    const counter = this.messageCounts.get(channel);

    if (!counter) return true;

    const now = Date.now();
    if (now >= counter.resetAt) {
      counter.count = 0;
      counter.resetAt = now + 1000; // Reset every second
    }

    if (counter.count >= channelDef.rateLimit) {
      return false; // Rate limited
    }

    counter.count++;
    return true;
  }

  private sendToClient(ws: WebSocket, data: unknown): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }
}
