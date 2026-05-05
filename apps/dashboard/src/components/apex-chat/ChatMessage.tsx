/**
 * ChatMessage — single message bubble. Handles user/assistant/tool roles.
 *
 * Markdown is rendered via a tiny inline subset (bold/italic/headings/lists/
 * code-block fences) to keep the bundle small. If the host app later pulls
 * `react-markdown` we can swap this out for a fuller renderer.
 */

import { memo } from 'react';
import { Bot, User, FileText, AlertTriangle } from 'lucide-react';
import type { ChatMessage as ChatMessageType } from './ChatHistoryStore';
import { ToolCallCard } from './ToolCallCard';

interface ChatMessageProps {
  message: ChatMessageType;
}

function MiniMarkdown({ text }: { text: string }) {
  // Split out fenced code blocks first (```...```)
  const parts = text.split(/(```[\s\S]*?```)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const inner = part.slice(3, -3).replace(/^[a-zA-Z]+\n/, '');
          return (
            <pre
              key={i}
              className="my-2 overflow-x-auto rounded-md bg-slate-900/60 p-3 text-[11px] leading-relaxed text-slate-200 ring-1 ring-slate-700/40"
            >
              <code>{inner}</code>
            </pre>
          );
        }
        return (
          <div key={i} className="space-y-1">
            {part.split('\n').map((line, li) => {
              const formatted = line
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/`([^`]+)`/g, '<code class="rounded bg-slate-700/60 px-1 py-0.5 text-[11px]">$1</code>')
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.+?)\*/g, '<em>$1</em>')
                .replace(/^#{3}\s+(.+)/, '<strong class="text-white">$1</strong>')
                .replace(/^#{1,2}\s+(.+)/, '<strong class="text-white text-base">$1</strong>')
                .replace(/^[-•]\s+/, '• ');
              return (
                <p
                  key={li}
                  className={line.trim() === '' ? 'h-2' : 'leading-relaxed'}
                  // eslint-disable-next-line react/no-danger
                  dangerouslySetInnerHTML={{ __html: formatted || '&nbsp;' }}
                />
              );
            })}
          </div>
        );
      })}
    </>
  );
}

function ChatMessageInner({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  if (isSystem) {
    return (
      <div className="flex justify-center py-1">
        <div className="rounded-full bg-slate-800/70 px-3 py-1 text-[10px] text-slate-400 ring-1 ring-slate-700/40">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div
          className="mt-1 shrink-0 rounded-lg bg-indigo-500/15 p-1.5 ring-1 ring-indigo-500/30"
          aria-hidden="true"
        >
          <Bot className="h-3.5 w-3.5 text-indigo-300" />
        </div>
      )}
      <div className={`max-w-[85%] ${isUser ? 'order-first' : ''}`}>
        {message.toolCall ? (
          <ToolCallCard messageId={message.messageId} toolCall={message.toolCall} />
        ) : (
          <div
            className={`rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${
              isUser
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800/80 text-slate-100 ring-1 ring-slate-700/40'
            }`}
          >
            {message.attachments && message.attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {message.attachments.map((f, fi) =>
                  f.preview ? (
                    <img
                      key={fi}
                      src={f.preview}
                      alt={f.name}
                      className="max-h-32 rounded-lg object-contain"
                    />
                  ) : (
                    <div
                      key={fi}
                      className="flex items-center gap-1.5 rounded bg-slate-700/50 px-2 py-1 text-[11px] text-slate-300"
                    >
                      <FileText className="h-3 w-3" /> {f.name}
                    </div>
                  ),
                )}
              </div>
            )}
            {message.content && <MiniMarkdown text={message.content} />}
          </div>
        )}

        <div className="mt-0.5 flex items-center gap-2 px-1 text-[10px] text-slate-500">
          <time dateTime={new Date(message.ts).toISOString()}>
            {new Date(message.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </time>
          {message.meta?.modelsUsed && message.meta.modelsUsed.length > 0 && (
            <span className="rounded-full bg-indigo-500/10 px-1.5 py-0.5 text-[9px] text-indigo-300">
              {message.meta.modelsUsed.length === 1
                ? message.meta.modelsUsed[0]
                : `${message.meta.modelsUsed.length} models`}
            </span>
          )}
          {message.meta?.regime && (
            <span className="rounded-full bg-slate-700/40 px-1.5 py-0.5 text-[9px] text-slate-300">
              {message.meta.regime.replace(/_/g, ' ')}
            </span>
          )}
          {message.toolCall?.status === 'error' && (
            <span className="inline-flex items-center gap-1 text-rose-400">
              <AlertTriangle className="h-3 w-3" /> tool error
            </span>
          )}
        </div>
      </div>
      {isUser && (
        <div className="mt-1 shrink-0 rounded-lg bg-slate-700/80 p-1.5 ring-1 ring-slate-600/40">
          <User className="h-3.5 w-3.5 text-slate-200" />
        </div>
      )}
    </div>
  );
}

export const ChatMessage = memo(ChatMessageInner);
