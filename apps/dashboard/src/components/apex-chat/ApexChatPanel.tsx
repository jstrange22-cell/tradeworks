/**
 * ApexChatPanel — right-pinned, persistent APEX chat surface.
 *
 * Layout:
 *   - Desktop ≥ xl (1280px+): always-mounted 380px panel hugging the right edge.
 *   - Below xl: collapsible drawer triggered by a chat-bubble FAB.
 *
 * Persistence: all conversation state lives in IndexedDB (see ChatHistoryStore).
 * Mounted in <App /> so it survives navigation.
 *
 * Tool calling pipeline (see brief):
 *   1. User sends message → POST /apex/chat with conversation history.
 *   2. If response shape is `{type: 'tool_call', tool, args}`: render
 *      ToolCallCard, await user confirm if mutating, invoke tool, write
 *      `{role:'tool', toolCall.result}` and ALSO POST a synthetic follow-up
 *      to /apex/chat so APEX produces a final summary.
 *   3. If response shape is `{type: 'message', content}` OR the existing
 *      `{data: {reply, modelsUsed, context}}` shape: render as assistant text.
 *
 * The dashboard also auto-runs SAFE tools when the user invokes them via the
 * @-mention shortcut so users can trigger e.g. `kill_switch_status` directly.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Bot,
  ChevronRight,
  History,
  MessageSquarePlus,
  PanelRightClose,
  Trash2,
  X,
  Loader2,
} from 'lucide-react';
import { apiClient, ApiError } from '@/lib/api-client';
import { useUIStore } from '@/stores/ui-store';
import {
  buildMessage,
  useChatHistory,
  type ChatAttachment,
  type ChatMessage as ChatMessageType,
  type ChatToolCall,
} from './ChatHistoryStore';
import { fetchTools, type ClientTool } from './ToolRegistry';
import { ChatMessage } from './ChatMessage';
import { ChatInput, type ChatInputHandle } from './ChatInput';
import { QuickActions } from './QuickActions';

// ── Response-shape adapters ─────────────────────────────────────────────

interface ChatRequestPayload {
  message: string;
  files?: Array<{ name: string; mimeType: string; data: string }>;
  /** Conversation history — sent for forward-compat. The legacy gateway uses
   *  per-user in-memory history and ignores this; the upgraded endpoint will
   *  use it. */
  history?: Array<{ role: 'user' | 'assistant' | 'tool'; content: string }>;
}

type ToolCallChatResponse = {
  type: 'tool_call';
  tool: string;
  args: Record<string, unknown>;
};

type MessageChatResponse = {
  type: 'message';
  content: string;
  modelsUsed?: string[];
  regime?: string;
};

type LegacyChatResponse = {
  data: {
    reply: string;
    modelsUsed?: string[];
    context?: { regime?: string };
  };
};

type ChatResponse = ToolCallChatResponse | MessageChatResponse | LegacyChatResponse;

function isToolCallResponse(r: unknown): r is ToolCallChatResponse {
  return !!r && typeof r === 'object' && (r as { type?: unknown }).type === 'tool_call';
}
function isMessageResponse(r: unknown): r is MessageChatResponse {
  return !!r && typeof r === 'object' && (r as { type?: unknown }).type === 'message';
}
function isLegacyResponse(r: unknown): r is LegacyChatResponse {
  return (
    !!r
    && typeof r === 'object'
    && 'data' in (r as Record<string, unknown>)
    && typeof (r as { data?: { reply?: unknown } }).data?.reply === 'string'
  );
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Lightweight regex to spot a tool name typed as `@tool_name` so we can short-
// circuit and call the tool directly instead of sending it to the model.
function extractInlineToolCall(
  text: string,
  tools: ClientTool[],
): { tool: ClientTool; rest: string } | null {
  const m = text.match(/@([\w-]+)/);
  if (!m) return null;
  const name = m[1];
  const tool = tools.find((t) => t.name === name);
  if (!tool) return null;
  const rest = text.replace(m[0], '').trim();
  return { tool, rest };
}

// ── Component ───────────────────────────────────────────────────────────

export function ApexChatPanel() {
  const apexChatOpen = useUIStore((s) => s.apexChatOpen);
  const setApexChatOpen = useUIStore((s) => s.setApexChatOpen);
  const apexHistoryCollapsed = useUIStore((s) => s.apexHistoryCollapsed);
  const toggleApexHistory = useUIStore((s) => s.toggleApexHistory);

  const hydrate = useChatHistory((s) => s.hydrate);
  const hydrated = useChatHistory((s) => s.hydrated);
  const conversations = useChatHistory((s) => s.conversations);
  const order = useChatHistory((s) => s.order);
  const activeId = useChatHistory((s) => s.activeId);
  const newConversation = useChatHistory((s) => s.newConversation);
  const setActive = useChatHistory((s) => s.setActive);
  const appendMessage = useChatHistory((s) => s.appendMessage);
  const deleteConversation = useChatHistory((s) => s.deleteConversation);

  const [tools, setTools] = useState<ClientTool[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<ChatInputHandle>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    void fetchTools().then(setTools);
  }, []);

  const active = activeId ? conversations[activeId] : undefined;
  const messages = active?.messages ?? [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, busy]);

  // ── Send pipeline ────────────────────────────────────────────────────

  async function sendUserMessage(text: string, attachments: ChatAttachment[]) {
    setError(null);
    if (!text && attachments.length === 0) return;

    // Inline tool short-circuit (`@kill_switch_status` etc).
    const inline = extractInlineToolCall(text, tools);
    if (inline) {
      const userMsg = buildMessage('user', text, {
        attachments: attachments.length > 0 ? attachments : undefined,
      });
      await appendMessage(userMsg);
      const toolMsgId = newId('msg');
      const toolCall: ChatToolCall = {
        callId: newId('call'),
        tool: inline.tool.name,
        args: {},
        requiresConfirmation: inline.tool.requiresConfirmation,
        status: 'pending',
      };
      await appendMessage({
        messageId: toolMsgId,
        role: 'assistant',
        content: '',
        ts: Date.now(),
        toolCall,
      });
      // The ToolCallCard auto-runs safe tools, so no further wiring needed for
      // those. For mutating tools the user must click Confirm in the card.
      return;
    }

    const userMsg = buildMessage('user', text, {
      attachments: attachments.length > 0 ? attachments : undefined,
    });
    await appendMessage(userMsg);

    setBusy(true);
    try {
      const payload: ChatRequestPayload = { message: text };
      if (attachments.length > 0) {
        payload.files = attachments.map((a) => ({
          name: a.name,
          mimeType: a.mimeType,
          data: a.data,
        }));
      }
      payload.history = messages.map((m) => ({
        role: m.role === 'tool' || m.role === 'system' ? 'assistant' : m.role,
        content: m.content,
      }));

      const res = await apiClient.post<ChatResponse>('/apex/chat', payload);
      await handleChatResponse(res);
    } catch (err) {
      const msg = extractErrorMessage(err);
      setError(msg);
      await appendMessage(
        buildMessage('assistant', `Error: ${msg}\n\nTry again or start a new conversation.`),
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleChatResponse(res: unknown) {
    if (isToolCallResponse(res)) {
      const tool = tools.find((t) => t.name === res.tool);
      const requiresConfirmation = tool?.requiresConfirmation ?? false;
      const callId = newId('call');
      const messageId = newId('msg');
      await appendMessage({
        messageId,
        role: 'assistant',
        content: '',
        ts: Date.now(),
        toolCall: {
          callId,
          tool: res.tool,
          args: res.args ?? {},
          requiresConfirmation,
          status: 'pending',
        },
      });
      return;
    }
    if (isMessageResponse(res)) {
      await appendMessage(
        buildMessage('assistant', res.content, {
          meta: {
            ...(res.modelsUsed ? { modelsUsed: res.modelsUsed } : {}),
            ...(res.regime ? { regime: res.regime } : {}),
          },
        }),
      );
      return;
    }
    if (isLegacyResponse(res)) {
      const reply = res.data.reply;
      const meta: ChatMessageType['meta'] = {};
      if (res.data.modelsUsed) meta.modelsUsed = res.data.modelsUsed;
      if (res.data.context?.regime) meta.regime = res.data.context.regime;
      await appendMessage(
        buildMessage('assistant', reply, Object.keys(meta).length > 0 ? { meta } : {}),
      );
      return;
    }
    // Unknown shape — fall back to JSON dump for debuggability.
    await appendMessage(
      buildMessage('assistant', `Unexpected response shape:\n\`\`\`\n${JSON.stringify(res, null, 2)}\n\`\`\``),
    );
  }

  // ── Quick-action handlers ────────────────────────────────────────────

  function handleQuickPrompt(prompt: string) {
    void sendUserMessage(prompt, []);
  }

  function handleQuickCustom(kind: 'why-veto' | 'pause-strategy') {
    if (kind === 'why-veto') {
      const id = window.prompt('Decision/signal ID to investigate (or describe the trade):');
      if (!id) return;
      void sendUserMessage(`Why did you veto signal ${id}? Walk me through your reasoning.`, []);
      return;
    }
    if (kind === 'pause-strategy') {
      const strategy = window.prompt('Strategy name to pause:');
      if (!strategy) return;
      const reason = window.prompt('Reason (one line):') ?? 'manual pause';
      void sendUserMessage(
        `@pause_strategy strategy=${strategy} hours=24 reason="${reason}"`,
        [],
      );
    }
  }

  // ── Render: closed FAB ───────────────────────────────────────────────

  if (!apexChatOpen) {
    return (
      <button
        type="button"
        onClick={() => setApexChatOpen(true)}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xl ring-1 ring-indigo-400/30 transition-transform hover:scale-105 hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        aria-label="Open APEX chat"
      >
        <Bot className="h-4 w-4" />
        APEX
      </button>
    );
  }

  // ── Render: open panel ───────────────────────────────────────────────

  return (
    <>
      {/* Mobile/tablet backdrop */}
      <button
        type="button"
        aria-label="Close APEX chat"
        onClick={() => setApexChatOpen(false)}
        className="fixed inset-0 z-30 bg-slate-950/40 backdrop-blur-sm xl:hidden"
      />

      <aside
        role="complementary"
        aria-label="APEX assistant"
        className="fixed inset-y-0 right-0 z-40 flex w-[min(380px,100vw)] flex-col border-l border-slate-700/60 bg-slate-900/95 text-slate-100 shadow-2xl backdrop-blur-md xl:shadow-none"
      >
        {/* Header */}
        <header className="flex items-center gap-2 border-b border-slate-700/40 px-3 py-2">
          <div className="rounded-lg bg-indigo-500/15 p-1.5 ring-1 ring-indigo-500/30">
            <Bot className="h-4 w-4 text-indigo-300" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-white">APEX</span>
              <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-medium text-emerald-300 ring-1 ring-emerald-500/30">
                online
              </span>
              {tools.length > 0 && (
                <span className="rounded-full bg-slate-700/60 px-1.5 py-0.5 text-[9px] text-slate-300">
                  {tools.length} tools
                </span>
              )}
            </div>
            <p className="truncate text-[10px] text-slate-400">
              {active?.title ?? 'Persistent control surface'}
            </p>
          </div>
          <button
            type="button"
            onClick={toggleApexHistory}
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
            aria-label="Toggle history"
            title="Conversation history"
          >
            <History className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => { void newConversation(); }}
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
            aria-label="New conversation"
            title="New conversation"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setApexChatOpen(false)}
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
            aria-label="Hide APEX panel"
            title="Hide panel"
          >
            <PanelRightClose className="h-3.5 w-3.5" />
          </button>
        </header>

        <div className="flex flex-1 min-h-0">
          {/* History sidebar */}
          {!apexHistoryCollapsed && (
            <nav
              aria-label="Conversation history"
              className="flex w-32 shrink-0 flex-col border-r border-slate-700/40 bg-slate-900/70"
            >
              <ul className="flex-1 overflow-y-auto py-1">
                {order.slice(0, 20).map((id) => {
                  const c = conversations[id];
                  if (!c) return null;
                  const isActive = id === activeId;
                  return (
                    <li key={id} className="px-1">
                      <div
                        className={`group flex items-center rounded-md text-[11px] ${
                          isActive ? 'bg-indigo-500/15 text-white' : 'text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => { void setActive(id); }}
                          className="flex-1 truncate px-2 py-1.5 text-left"
                          title={c.title}
                        >
                          {c.title}
                        </button>
                        <button
                          type="button"
                          onClick={() => { void deleteConversation(id); }}
                          className="invisible mr-1 rounded p-0.5 text-slate-500 hover:bg-slate-700 hover:text-rose-300 group-hover:visible"
                          aria-label={`Delete ${c.title}`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </li>
                  );
                })}
                {order.length === 0 && (
                  <li className="px-2 py-2 text-[10px] text-slate-500">No history yet.</li>
                )}
              </ul>
              <button
                type="button"
                onClick={toggleApexHistory}
                className="border-t border-slate-700/40 px-2 py-1 text-[10px] text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <ChevronRight className="mx-auto h-3 w-3" />
              </button>
            </nav>
          )}

          {/* Main column */}
          <div className="flex flex-1 min-w-0 flex-col">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-3 py-3">
              {!hydrated ? (
                <div className="flex h-full items-center justify-center text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : messages.length === 0 ? (
                <EmptyState />
              ) : (
                <div className="space-y-3">
                  {messages.map((m) => (
                    <ChatMessage key={m.messageId} message={m} />
                  ))}
                  {busy && (
                    <div className="flex items-center gap-2 text-[11px] text-slate-400">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      APEX is thinking…
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {error && (
              <div className="mx-3 mb-2 flex items-start gap-2 rounded-md bg-rose-500/10 p-2 text-[11px] text-rose-200 ring-1 ring-rose-500/30">
                <span className="flex-1">{error}</span>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  className="rounded p-0.5 hover:bg-rose-500/20"
                  aria-label="Dismiss error"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}

            <QuickActions onPrompt={handleQuickPrompt} onCustom={handleQuickCustom} disabled={busy} />

            <ChatInput ref={inputRef} onSend={sendUserMessage} busy={busy} tools={tools} />
          </div>
        </div>
      </aside>
    </>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-4 text-center">
      <div className="rounded-2xl bg-indigo-500/10 p-3 ring-1 ring-indigo-500/30">
        <Bot className="h-7 w-7 text-indigo-300" />
      </div>
      <h2 className="mt-3 text-sm font-semibold text-white">Talk to APEX</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
        Ask why a signal was vetoed, check kill switches, pause a strategy — or just chat about
        the market. Try the quick actions below.
      </p>
    </div>
  );
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    try {
      const parsed = JSON.parse(err.body) as { error?: string; message?: string };
      return parsed.error ?? parsed.message ?? err.message;
    } catch {
      return err.message;
    }
  }
  if (err instanceof Error) return err.message;
  return 'Failed to reach APEX.';
}
