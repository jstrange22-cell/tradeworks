/**
 * ChatInput — autosizing textarea + file uploads + tool-mention dropdown.
 *
 * Features:
 *   - Enter to send, Shift+Enter for newline.
 *   - Paste images directly into the textarea.
 *   - Attachments preview row (matches the existing ApexChatPage UI).
 *   - `@` types a tool mention; an inline picker shows matching tool names so
 *     users can fast-call a tool without forming a sentence.
 *   - File limits: image/png|jpeg|webp|gif, application/pdf, text/plain|csv,
 *     8 MB each, 5 max per send.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Paperclip, Send, X, FileText, AtSign } from 'lucide-react';
import type { ChatAttachment } from './ChatHistoryStore';
import type { ClientTool } from './ToolRegistry';

const ALLOWED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'text/csv',
];
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 5;

export interface ChatInputHandle {
  focus: () => void;
  setText: (text: string) => void;
}

interface ChatInputProps {
  onSend: (text: string, attachments: ChatAttachment[]) => void;
  busy: boolean;
  tools: ClientTool[];
  placeholder?: string;
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput(
  { onSend, busy, tools, placeholder },
  ref,
) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => taRef.current?.focus(),
    setText: (t) => {
      setText(t);
      requestAnimationFrame(() => {
        taRef.current?.focus();
        taRef.current?.setSelectionRange(t.length, t.length);
      });
    },
  }));

  // Auto-resize textarea
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  // Mention detection: look at the last word starting with `@`
  const matchingTools = useMemo<ClientTool[]>(() => {
    if (mentionQuery == null) return [];
    const q = mentionQuery.toLowerCase();
    return tools
      .filter((t) => t.name.toLowerCase().includes(q) || t.label.toLowerCase().includes(q))
      .slice(0, 6);
  }, [mentionQuery, tools]);

  function updateMentionQuery(value: string, caret: number) {
    const before = value.slice(0, caret);
    const m = before.match(/(?:^|\s)@([\w-]*)$/);
    setMentionQuery(m ? m[1] ?? '' : null);
    setMentionIndex(0);
  }

  function applyMention(tool: ClientTool) {
    const el = taRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? text.length;
    const before = text.slice(0, caret);
    const after = text.slice(caret);
    const replaced = before.replace(/(?:^|\s)@([\w-]*)$/, (m) => {
      const lead = m.startsWith('@') ? '' : m[0];
      return `${lead}@${tool.name} `;
    });
    const next = `${replaced}${after}`;
    setText(next);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      const pos = replaced.length;
      el.setSelectionRange(pos, pos);
    });
  }

  const handleFileSelect = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const next: ChatAttachment[] = [];
    for (const file of Array.from(files).slice(0, MAX_FILES)) {
      if (!ALLOWED_TYPES.includes(file.type)) continue;
      if (file.size > MAX_BYTES) continue;
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1] ?? '');
        };
        reader.readAsDataURL(file);
      });
      const preview = file.type.startsWith('image/')
        ? `data:${file.type};base64,${base64}`
        : undefined;
      next.push({ name: file.name, mimeType: file.type, data: base64, preview });
    }
    setAttachments((prev) => [...prev, ...next].slice(0, MAX_FILES));
  }, []);

  function send() {
    const trimmed = text.trim();
    if ((!trimmed && attachments.length === 0) || busy) return;
    onSend(trimmed, attachments);
    setText('');
    setAttachments([]);
    setMentionQuery(null);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionQuery != null && matchingTools.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % matchingTools.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + matchingTools.length) % matchingTools.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const choice = matchingTools[mentionIndex];
        if (choice) applyMention(choice);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="border-t border-slate-700/40 bg-slate-900/70 px-3 pb-3 pt-2">
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {attachments.map((file, i) => (
            <div
              key={`${file.name}-${i}`}
              className="group relative rounded-lg border border-slate-700 bg-slate-800/80 p-1"
            >
              {file.preview ? (
                <img
                  src={file.preview}
                  alt={file.name}
                  className="h-12 w-12 rounded object-cover"
                />
              ) : (
                <div className="flex h-12 w-12 flex-col items-center justify-center rounded bg-slate-700/60">
                  <FileText className="h-4 w-4 text-slate-300" />
                  <span className="mt-0.5 max-w-[44px] truncate text-[9px] text-slate-400">
                    {file.name}
                  </span>
                </div>
              )}
              <button
                type="button"
                onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                className="absolute -right-1.5 -top-1.5 rounded-full bg-rose-600 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                aria-label={`Remove ${file.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Mention dropdown */}
      {mentionQuery != null && matchingTools.length > 0 && (
        <div
          className="mb-2 max-h-44 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900/95 shadow-lg ring-1 ring-black/40"
          role="listbox"
          aria-label="Tool mentions"
        >
          {matchingTools.map((tool, i) => (
            <button
              key={tool.name}
              type="button"
              onClick={() => applyMention(tool)}
              role="option"
              aria-selected={i === mentionIndex}
              className={`flex w-full items-start gap-2 px-2.5 py-1.5 text-left text-[12px] ${
                i === mentionIndex
                  ? 'bg-indigo-500/20 text-white'
                  : 'text-slate-200 hover:bg-slate-800'
              }`}
            >
              <AtSign className="mt-0.5 h-3 w-3 shrink-0 text-indigo-300" />
              <div className="min-w-0 flex-1">
                <div className="font-mono font-semibold">{tool.name}</div>
                {tool.description && (
                  <div className="truncate text-[10px] text-slate-400">
                    {tool.description}
                  </div>
                )}
              </div>
              {tool.requiresConfirmation && (
                <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] text-amber-300">
                  mutating
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-1.5">
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ALLOWED_TYPES.join(',')}
          className="hidden"
          onChange={(e) => {
            void handleFileSelect(e.target.files);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="rounded-lg border border-slate-700 bg-slate-800/80 p-2 text-slate-300 transition-colors hover:border-indigo-500/40 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          aria-label="Attach files"
          title="Attach files"
        >
          <Paperclip className="h-3.5 w-3.5" />
        </button>
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const caret = e.target.selectionStart ?? e.target.value.length;
            updateMentionQuery(e.target.value, caret);
          }}
          onKeyDown={handleKeyDown}
          onPaste={(e) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            const imageFiles: File[] = [];
            for (const item of Array.from(items)) {
              if (item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (file) imageFiles.push(file);
              }
            }
            if (imageFiles.length > 0) {
              e.preventDefault();
              const dt = new DataTransfer();
              imageFiles.forEach((f) => dt.items.add(f));
              void handleFileSelect(dt.files);
            }
          }}
          rows={1}
          placeholder={placeholder ?? 'Ask APEX… (try @ to mention a tool)'}
          aria-label="Message APEX"
          className="flex-1 resize-none rounded-lg border border-slate-700 bg-slate-800/70 px-3 py-2 text-[13px] leading-relaxed text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          style={{ maxHeight: '160px' }}
        />
        <button
          type="button"
          onClick={send}
          disabled={busy || (!text.trim() && attachments.length === 0)}
          className="rounded-lg bg-indigo-600 p-2 text-white transition-colors hover:bg-indigo-500 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          aria-label="Send message"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mt-1 px-1 text-[9px] text-slate-500">
        Enter to send · Shift+Enter newline · @ for tools · paste images with Ctrl+V
      </p>
    </div>
  );
});
