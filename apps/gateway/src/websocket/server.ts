import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'http';
import type { IncomingMessage } from 'http';
import jwt from 'jsonwebtoken';
import type { AuthUser } from '../middleware/auth.js';
import {
  CHANNELS,
  type ChannelName,
  ChannelManager,
} from './channels.js';

const JWT_SECRET = process.env.JWT_SECRET ?? 'tradeworks-dev-secret-change-in-production';

export interface AuthenticatedWebSocket extends WebSocket {
  user?: AuthUser;
  subscriptions: Set<ChannelName>;
  isAlive: boolean;
}

let channelManager: ChannelManager;

/**
 * Set up the WebSocket server attached to the HTTP server.
 */
export function setupWebSocket(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    verifyClient: (info, callback) => {
      // Extract token from query parameter or Authorization header
      const url = new URL(info.req.url ?? '', `http://${info.req.headers.host}`);
      const token = url.searchParams.get('token') ?? extractBearerToken(info.req);

      if (!token) {
        callback(false, 401, 'Authentication required');
        return;
      }

      try {
        const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
        (info.req as IncomingMessage & { user: AuthUser }).user = decoded;
        callback(true);
      } catch {
        callback(false, 401, 'Invalid or expired token');
      }
    },
  });

  channelManager = new ChannelManager();

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const authWs = ws as AuthenticatedWebSocket;
    authWs.user = (req as IncomingMessage & { user?: AuthUser }).user;
    authWs.subscriptions = new Set();
    authWs.isAlive = true;

    console.log(`[WebSocket] Client connected: ${authWs.user?.email ?? 'unknown'}`);

    // Send welcome message
    sendMessage(authWs, {
      type: 'connected',
      channels: Object.keys(CHANNELS),
      message: 'Connected to TradeWorks WebSocket. Subscribe to channels to receive updates.',
    });

    // Handle incoming messages
    authWs.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as {
          action: string;
          channel?: string;
        };

        handleMessage(authWs, message);
      } catch {
        sendMessage(authWs, {
          type: 'error',
          message: 'Invalid JSON message',
        });
      }
    });

    // Heartbeat
    authWs.on('pong', () => {
      authWs.isAlive = true;
    });

    // Handle disconnect
    authWs.on('close', () => {
      console.log(`[WebSocket] Client disconnected: ${authWs.user?.email ?? 'unknown'}`);
      // Unsubscribe from all channels
      for (const channel of authWs.subscriptions) {
        channelManager.unsubscribe(channel, authWs);
      }
    });

    authWs.on('error', (error) => {
      console.error(`[WebSocket] Error for ${authWs.user?.email}:`, error);
    });
  });

  // Heartbeat interval - detect dead connections
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const authWs = ws as AuthenticatedWebSocket;
      if (!authWs.isAlive) {
        console.log(`[WebSocket] Terminating dead connection: ${authWs.user?.email ?? 'unknown'}`);
        authWs.terminate();
        return;
      }
      authWs.isAlive = false;
      authWs.ping();
    });
  }, 30_000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  console.log(`[WebSocket] Server initialized with ${Object.keys(CHANNELS).length} channels`);

  return wss;
}

/**
 * Handle an incoming WebSocket message.
 */
function handleMessage(
  ws: AuthenticatedWebSocket,
  message: { action: string; channel?: string },
): void {
  switch (message.action) {
    case 'subscribe': {
      if (!message.channel) {
        sendMessage(ws, { type: 'error', message: 'Channel name required for subscribe' });
        return;
      }
      const channel = message.channel as ChannelName;
      if (!CHANNELS[channel]) {
        sendMessage(ws, {
          type: 'error',
          message: `Unknown channel: ${message.channel}. Available: ${Object.keys(CHANNELS).join(', ')}`,
        });
        return;
      }
      channelManager.subscribe(channel, ws);
      ws.subscriptions.add(channel);
      sendMessage(ws, { type: 'subscribed', channel });
      break;
    }

    case 'unsubscribe': {
      if (!message.channel) {
        sendMessage(ws, { type: 'error', message: 'Channel name required for unsubscribe' });
        return;
      }
      const channel = message.channel as ChannelName;
      channelManager.unsubscribe(channel, ws);
      ws.subscriptions.delete(channel);
      sendMessage(ws, { type: 'unsubscribed', channel });
      break;
    }

    case 'ping': {
      sendMessage(ws, { type: 'pong', timestamp: Date.now() });
      break;
    }

    case 'list_channels': {
      sendMessage(ws, {
        type: 'channels',
        channels: Object.entries(CHANNELS).map(([name, info]) => ({
          name,
          description: info.description,
          subscribed: ws.subscriptions.has(name as ChannelName),
        })),
      });
      break;
    }

    default:
      sendMessage(ws, { type: 'error', message: `Unknown action: ${message.action}` });
  }
}

/**
 * Send a JSON message to a WebSocket client.
 */
function sendMessage(ws: WebSocket, data: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

/**
 * Broadcast a message to all subscribers of a channel.
 * Exported for use by other services (e.g., trade execution, risk updates).
 */
export function broadcast(channel: ChannelName, data: unknown): void {
  if (channelManager) {
    channelManager.broadcast(channel, data);
  }
}

function extractBearerToken(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.slice(7);
}
