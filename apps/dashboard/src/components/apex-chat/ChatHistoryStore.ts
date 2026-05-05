/**
 * ChatHistoryStore — Zustand slice + IndexedDB persistence (idb-keyval) for the
 * pinned APEX chat panel. Survives page navigation AND browser reloads.
 *
 * Schema (per-message):
 *   { messageId, role, content, ts, attachments?, toolCall?, toolResult? }
 *
 * Schema (per-conversation):
 *   { id, title, createdAt, updatedAt, messages[] }
 *
 * Storage layout in IndexedDB (idb-keyval default 'keyval-store' DB):
 *   apex.conversations         → string[]  (conversation IDs, newest-first)
 *   apex.conversation.<id>     → Conversation
 *   apex.activeConversationId  → string | null
 */

import { create } from 'zustand';
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';

// ── Types ───────────────────────────────────────────────────────────────

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ChatAttachment {
  name: string;
  mimeType: string;
  data: string; // base64
  preview?: string; // data URL
}

export interface ChatToolCall {
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  /** Tools that mutate state (kill switches, pauses) require explicit user confirm. */
  requiresConfirmation: boolean;
  /** UI state: pending → running → done / error / vetoed. */
  status: 'pending' | 'running' | 'done' | 'error' | 'vetoed';
  result?: unknown;
  error?: string;
}

export interface ChatMessage {
  messageId: string;
  role: ChatRole;
  content: string;
  ts: number;
  attachments?: ChatAttachment[];
  toolCall?: ChatToolCall;
  /** Optional metadata: which models contributed, regime tag, etc. */
  meta?: {
    modelsUsed?: string[];
    regime?: string;
  };
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

// ── IndexedDB keys ──────────────────────────────────────────────────────

const KEY_LIST = 'apex.conversations';
const KEY_ACTIVE = 'apex.activeConversationId';
const keyConvo = (id: string) => `apex.conversation.${id}`;

// ── Helpers ─────────────────────────────────────────────────────────────

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function deriveTitle(firstUserMessage: string | undefined): string {
  if (!firstUserMessage) return 'New conversation';
  const trimmed = firstUserMessage.trim().replace(/\s+/g, ' ');
  return trimmed.length > 50 ? `${trimmed.slice(0, 50)}…` : trimmed;
}

function nowConversation(): Conversation {
  const id = newId('conv');
  const ts = Date.now();
  return { id, title: 'New conversation', createdAt: ts, updatedAt: ts, messages: [] };
}

// ── Store ───────────────────────────────────────────────────────────────

interface ChatHistoryState {
  /** Map of loaded conversations by id (lazy — list comes from KEY_LIST). */
  conversations: Record<string, Conversation>;
  /** Ordered list of conversation IDs, newest-first. Mirrors KEY_LIST. */
  order: string[];
  /** Currently-displayed conversation. */
  activeId: string | null;
  /** Hydration flag — true after `hydrate()` finished. */
  hydrated: boolean;

  hydrate: () => Promise<void>;
  newConversation: () => Promise<string>;
  setActive: (id: string) => Promise<void>;
  appendMessage: (message: ChatMessage) => Promise<void>;
  patchMessage: (messageId: string, patch: Partial<ChatMessage>) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  /** Returns the active conversation (or undefined if none). */
  active: () => Conversation | undefined;
}

const MAX_SIDEBAR_CONVERSATIONS = 20;

export const useChatHistory = create<ChatHistoryState>((set, get) => ({
  conversations: {},
  order: [],
  activeId: null,
  hydrated: false,

  active: () => {
    const { activeId, conversations } = get();
    return activeId ? conversations[activeId] : undefined;
  },

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const order = (await idbGet<string[]>(KEY_LIST)) ?? [];
      const trimmed = order.slice(0, MAX_SIDEBAR_CONVERSATIONS);
      const loaded: Record<string, Conversation> = {};
      for (const id of trimmed) {
        const c = await idbGet<Conversation>(keyConvo(id));
        if (c) loaded[id] = c;
      }
      let activeId = (await idbGet<string | null>(KEY_ACTIVE)) ?? null;
      if (activeId && !loaded[activeId]) activeId = null;
      // If nothing exists, lazily create one.
      if (trimmed.length === 0) {
        const c = nowConversation();
        loaded[c.id] = c;
        trimmed.push(c.id);
        activeId = c.id;
        await idbSet(keyConvo(c.id), c);
        await idbSet(KEY_LIST, trimmed);
        await idbSet(KEY_ACTIVE, c.id);
      } else if (!activeId) {
        activeId = trimmed[0] ?? null;
        if (activeId) await idbSet(KEY_ACTIVE, activeId);
      }
      set({ conversations: loaded, order: trimmed, activeId, hydrated: true });
    } catch (err) {
      // IndexedDB unavailable (e.g. private mode + iOS). Fall back to in-memory.
      console.warn('[ApexChat] IndexedDB hydration failed; using in-memory only', err);
      const c = nowConversation();
      set({
        conversations: { [c.id]: c },
        order: [c.id],
        activeId: c.id,
        hydrated: true,
      });
    }
  },

  newConversation: async () => {
    const c = nowConversation();
    const order = [c.id, ...get().order].slice(0, 100); // hard cap to 100 stored
    const conversations = { ...get().conversations, [c.id]: c };
    set({ conversations, order, activeId: c.id });
    try {
      await idbSet(keyConvo(c.id), c);
      await idbSet(KEY_LIST, order);
      await idbSet(KEY_ACTIVE, c.id);
    } catch { /* swallow */ }
    return c.id;
  },

  setActive: async (id) => {
    if (!get().conversations[id]) {
      const c = await idbGet<Conversation>(keyConvo(id));
      if (!c) return;
      set((s) => ({ conversations: { ...s.conversations, [id]: c } }));
    }
    set({ activeId: id });
    try { await idbSet(KEY_ACTIVE, id); } catch { /* swallow */ }
  },

  appendMessage: async (message) => {
    const { activeId, conversations, order } = get();
    if (!activeId) return;
    const current = conversations[activeId];
    if (!current) return;

    const updated: Conversation = {
      ...current,
      messages: [...current.messages, message],
      updatedAt: Date.now(),
    };
    // Auto-title from first user message
    if (current.title === 'New conversation' && message.role === 'user' && message.content) {
      updated.title = deriveTitle(message.content);
    }
    // Bump conversation to top of the order list
    const newOrder = [activeId, ...order.filter((x) => x !== activeId)];
    set({
      conversations: { ...conversations, [activeId]: updated },
      order: newOrder,
    });
    try {
      await idbSet(keyConvo(activeId), updated);
      await idbSet(KEY_LIST, newOrder);
    } catch { /* swallow */ }
  },

  patchMessage: async (messageId, patch) => {
    const { activeId, conversations } = get();
    if (!activeId) return;
    const current = conversations[activeId];
    if (!current) return;
    const idx = current.messages.findIndex((m) => m.messageId === messageId);
    if (idx < 0) return;
    const next: ChatMessage = { ...current.messages[idx]!, ...patch };
    const messages = [...current.messages];
    messages[idx] = next;
    const updated: Conversation = { ...current, messages, updatedAt: Date.now() };
    set({ conversations: { ...conversations, [activeId]: updated } });
    try { await idbSet(keyConvo(activeId), updated); } catch { /* swallow */ }
  },

  deleteConversation: async (id) => {
    const order = get().order.filter((x) => x !== id);
    const conversations = { ...get().conversations };
    delete conversations[id];
    let activeId = get().activeId;
    if (activeId === id) activeId = order[0] ?? null;
    set({ conversations, order, activeId });
    try {
      await idbDel(keyConvo(id));
      await idbSet(KEY_LIST, order);
      if (activeId) await idbSet(KEY_ACTIVE, activeId); else await idbDel(KEY_ACTIVE);
    } catch { /* swallow */ }
    if (!activeId) {
      // Always keep at least one open conversation
      await get().newConversation();
    }
  },

  renameConversation: async (id, title) => {
    const c = get().conversations[id];
    if (!c) return;
    const updated: Conversation = { ...c, title, updatedAt: Date.now() };
    set((s) => ({ conversations: { ...s.conversations, [id]: updated } }));
    try { await idbSet(keyConvo(id), updated); } catch { /* swallow */ }
  },
}));

// Convenience: build a fresh ChatMessage from the message-shape contract.
export function buildMessage(role: ChatRole, content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    messageId: newId('msg'),
    role,
    content,
    ts: Date.now(),
    ...extra,
  };
}
