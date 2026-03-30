type MessageHandler = (data: WSMessage) => void;

interface WSMessage {
  channel: string;
  event: string;
  data: unknown;
  timestamp: string;
}

interface WSCommand {
  action: string;
  channel?: string;
  params?: Record<string, unknown>;
}

export class WSClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectDelay: number;
  private maxReconnectDelay: number;
  private currentDelay: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private globalHandlers: Set<MessageHandler> = new Set();
  private subscriptions: Set<string> = new Set();
  private _isConnected = false;

  constructor(
    url: string,
    options: { reconnectDelay?: number; maxReconnectDelay?: number } = {},
  ) {
    this.url = url;
    this.reconnectDelay = options.reconnectDelay ?? 1000;
    this.maxReconnectDelay = options.maxReconnectDelay ?? 30000;
    this.currentDelay = this.reconnectDelay;
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this._isConnected = true;
        this.currentDelay = this.reconnectDelay;

        // Re-subscribe to channels
        this.subscriptions.forEach((channel) => {
          this.send({ action: 'subscribe', channel });
        });
      };

      this.ws.onmessage = (event) => {
        try {
          const message: WSMessage = JSON.parse(event.data);
          this.dispatch(message);
        } catch {
          console.warn('[WS] Failed to parse message:', event.data);
        }
      };

      this.ws.onclose = () => {
        this._isConnected = false;
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this._isConnected = false;
      };
    } catch {
      this._isConnected = false;
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this._isConnected = false;
  }

  subscribe(channel: string): void {
    this.subscriptions.add(channel);
    if (this._isConnected) {
      this.send({ action: 'subscribe', channel });
    }
  }

  unsubscribe(channel: string): void {
    this.subscriptions.delete(channel);
    if (this._isConnected) {
      this.send({ action: 'unsubscribe', channel });
    }
  }

  on(channelOrEvent: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(channelOrEvent)) {
      this.handlers.set(channelOrEvent, new Set());
    }
    this.handlers.get(channelOrEvent)!.add(handler);
    return () => {
      this.handlers.get(channelOrEvent)?.delete(handler);
    };
  }

  onAny(handler: MessageHandler): () => void {
    this.globalHandlers.add(handler);
    return () => {
      this.globalHandlers.delete(handler);
    };
  }

  send(command: WSCommand): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(command));
    }
  }

  sendEmergencyStop(): void {
    this.send({ action: 'emergency_stop' });
  }

  sendCloseAll(): void {
    this.send({ action: 'close_all' });
  }

  private dispatch(message: WSMessage): void {
    // Dispatch to channel-specific handlers
    const channelHandlers = this.handlers.get(message.channel);
    channelHandlers?.forEach((handler) => handler(message));

    // Dispatch to event-specific handlers
    const eventHandlers = this.handlers.get(message.event);
    eventHandlers?.forEach((handler) => handler(message));

    // Dispatch to global handlers
    this.globalHandlers.forEach((handler) => handler(message));
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.currentDelay = Math.min(this.currentDelay * 2, this.maxReconnectDelay);
      this.connect();
    }, this.currentDelay);
  }
}

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:4000/ws';
export const wsClient = new WSClient(WS_URL);
