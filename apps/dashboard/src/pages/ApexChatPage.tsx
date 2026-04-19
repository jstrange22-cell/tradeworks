import { useState, useRef, useEffect, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { Send, Trash2, Bot, User, Loader2, TrendingUp, TrendingDown, Activity, Paperclip, X, FileText } from 'lucide-react';

interface FileAttachment {
  name: string;
  mimeType: string;
  data: string; // base64
  preview?: string; // data URL for image preview
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  files?: FileAttachment[];
  modelsUsed?: string[];
  context?: {
    regime: string;
    walletSol: number;
    winRate: number;
    activeStrategies: number;
    openPositions: number;
  };
  timestamp: Date;
}

interface ChatResponse {
  data: {
    reply: string;
    modelsUsed?: string[];
    context: {
      regime: string;
      walletSol: number;
      winRate: number;
      activeStrategies: number;
      openPositions: number;
    };
  };
}

const regimeIcon: Record<string, typeof TrendingUp> = {
  risk_on: TrendingUp,
  risk_off: TrendingDown,
  transitioning: Activity,
  crisis: TrendingDown,
};

const regimeColor: Record<string, string> = {
  risk_on: 'text-emerald-400',
  risk_off: 'text-red-400',
  transitioning: 'text-amber-400',
  crisis: 'text-red-500',
};

const QUICK_PROMPTS = [
  "How's my portfolio doing?",
  "What's the current market regime?",
  "Show me recent trade performance",
  "What strategies are running?",
  "How can I improve my win rate?",
  "Analyze my exit type breakdown",
];

export function ApexChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain', 'text/csv'];

  const handleFileSelect = useCallback(async (fileList: FileList | null) => {
    if (!fileList) return;
    const newAttachments: FileAttachment[] = [];
    for (const file of Array.from(fileList).slice(0, 5)) {
      if (!ALLOWED_TYPES.includes(file.type)) continue;
      if (file.size > 8 * 1024 * 1024) continue; // 8MB max
      const data = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]); // Strip data URL prefix, keep base64
        };
        reader.readAsDataURL(file);
      });
      const preview = file.type.startsWith('image/')
        ? `data:${file.type};base64,${data}`
        : undefined;
      newAttachments.push({ name: file.name, mimeType: file.type, data, preview });
    }
    setAttachments(prev => [...prev, ...newAttachments].slice(0, 5));
  }, []);

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const chatMutation = useMutation({
    mutationFn: (payload: { message: string; files?: FileAttachment[] }) =>
      apiClient.post<ChatResponse>('/apex/chat', {
        message: payload.message,
        files: payload.files?.map(f => ({ name: f.name, mimeType: f.mimeType, data: f.data })),
      }),
    onSuccess: (data) => {
      const reply = data.data;
      setMessages(prev => [...prev, {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: reply.reply,
        modelsUsed: reply.modelsUsed,
        context: reply.context,
        timestamp: new Date(),
      }]);
    },
    onError: (err) => {
      // Extract detailed error from ApiError body if available
      let errorDetail = 'Failed to reach APEX.';
      if (err instanceof Error) {
        errorDetail = err.message;
        if ('body' in err && typeof (err as Record<string, unknown>).body === 'string') {
          try {
            const parsed = JSON.parse((err as Record<string, unknown>).body as string);
            errorDetail = parsed.error ?? parsed.message ?? errorDetail;
          } catch { /* use default */ }
        }
      }
      setMessages(prev => [...prev, {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `Error: ${errorDetail}\n\nTry again or clear chat history and retry.`,
        timestamp: new Date(),
      }]);
    },
  });

  const sendMessage = (text?: string) => {
    const msg = (text ?? input).trim();
    const hasFiles = attachments.length > 0;
    if ((!msg && !hasFiles) || chatMutation.isPending) return;

    const currentFiles = [...attachments];
    setMessages(prev => [...prev, {
      id: `user-${Date.now()}`,
      role: 'user',
      content: msg || (currentFiles.length > 0 ? `[${currentFiles.map(f => f.name).join(', ')}]` : ''),
      files: currentFiles.length > 0 ? currentFiles : undefined,
      timestamp: new Date(),
    }]);
    setInput('');
    setAttachments([]);
    chatMutation.mutate({ message: msg || 'Analyze the attached file(s)', files: currentFiles.length > 0 ? currentFiles : undefined });
  };

  const clearChat = async () => {
    setMessages([]);
    try {
      await apiClient.delete('/apex/history');
    } catch { /* ignore */ }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col -m-2 md:-m-6" style={{ height: 'calc(100dvh - 3.5rem)' }}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-700/50 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-indigo-500/20 p-2">
            <Bot className="h-5 w-5 text-indigo-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">APEX</h1>
            <p className="text-xs text-slate-400">AI Trading Assistant</p>
          </div>
        </div>
        <button
          onClick={clearChat}
          className="rounded-lg p-2.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
          title="Clear chat"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center">
            <div className="rounded-2xl bg-indigo-500/10 p-4 mb-4">
              <Bot className="h-10 w-10 text-indigo-400" />
            </div>
            <h2 className="text-lg font-semibold text-white mb-1">Talk to APEX</h2>
            <p className="text-sm text-slate-400 mb-6 text-center max-w-md">
              Ask about your portfolio, market conditions, strategy performance, or get trade recommendations.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg w-full">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => sendMessage(prompt)}
                  className="rounded-lg border border-slate-700/50 bg-slate-800/50 px-3 py-2 text-left text-xs text-slate-300 transition-colors hover:border-indigo-500/30 hover:bg-slate-800"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' && (
                  <div className="mt-1 shrink-0 rounded-lg bg-indigo-500/20 p-1.5">
                    <Bot className="h-4 w-4 text-indigo-400" />
                  </div>
                )}
                <div className={`max-w-[90%] sm:max-w-[80%] ${msg.role === 'user' ? 'order-first' : ''}`}>
                  <div
                    className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-800 text-slate-200'
                    }`}
                  >
                    {/* Show attached images */}
                    {msg.files && msg.files.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {msg.files.map((f, fi) => f.preview ? (
                          <img key={fi} src={f.preview} alt={f.name} className="max-h-40 rounded-lg object-contain" />
                        ) : (
                          <div key={fi} className="flex items-center gap-1.5 rounded bg-slate-700/50 px-2 py-1 text-xs text-slate-300">
                            <FileText className="h-3 w-3" /> {f.name}
                          </div>
                        ))}
                      </div>
                    )}
                    {msg.content.split('\n').map((line, i) => {
                      // Basic markdown rendering
                      const formatted = line
                        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                        .replace(/\*(.+?)\*/g, '<em>$1</em>')
                        .replace(/^#{1,3}\s+(.+)/, '<strong>$1</strong>')
                        .replace(/^[-•]\s+/, '• ');
                      return (
                        <p
                          key={i}
                          className={`${i > 0 ? 'mt-1.5' : ''} ${line.startsWith('#') ? 'text-white font-semibold mt-3' : ''}`}
                          dangerouslySetInnerHTML={{ __html: formatted || '&nbsp;' }}
                        />
                      );
                    })}
                  </div>
                  {/* Context badge */}
                  {msg.context && (
                    <div className="mt-1 flex items-center gap-2 px-2">
                      {(() => {
                        const Icon = regimeIcon[msg.context.regime] ?? Activity;
                        const color = regimeColor[msg.context.regime] ?? 'text-slate-400';
                        return (
                          <span className={`flex items-center gap-1 text-[10px] ${color}`}>
                            <Icon className="h-3 w-3" />
                            {msg.context.regime.replace('_', ' ')}
                          </span>
                        );
                      })()}
                      <span className="text-[10px] text-slate-500">
                        {msg.context.walletSol.toFixed(3)} SOL
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {msg.context.winRate}% WR
                      </span>
                    </div>
                  )}
                  {/* Models used badge */}
                  {msg.modelsUsed && msg.modelsUsed.length > 1 && (
                    <div className="mt-1 px-2">
                      <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/10 px-2 py-0.5 text-[9px] font-medium text-indigo-400">
                        {msg.modelsUsed.length} models: {msg.modelsUsed.join(' + ')}
                      </span>
                    </div>
                  )}
                  <div className="mt-0.5 px-2 text-[10px] text-slate-600">
                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                {msg.role === 'user' && (
                  <div className="mt-1 shrink-0 rounded-lg bg-slate-700 p-1.5">
                    <User className="h-4 w-4 text-slate-300" />
                  </div>
                )}
              </div>
            ))}
            {chatMutation.isPending && (
              <div className="flex gap-3">
                <div className="mt-1 shrink-0 rounded-lg bg-indigo-500/20 p-1.5">
                  <Bot className="h-4 w-4 text-indigo-400" />
                </div>
                <div className="rounded-2xl bg-slate-800 px-4 py-3">
                  <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-slate-700/50 p-4">
        {/* Attachment previews */}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((file, i) => (
              <div key={i} className="group relative rounded-lg border border-slate-700 bg-slate-800 p-1">
                {file.preview ? (
                  <img src={file.preview} alt={file.name} className="h-16 w-16 rounded object-cover" />
                ) : (
                  <div className="flex h-16 w-16 flex-col items-center justify-center rounded bg-slate-700/50">
                    <FileText className="h-5 w-5 text-slate-400" />
                    <span className="mt-0.5 text-[10px] text-slate-500 truncate max-w-[56px]">{file.name}</span>
                  </div>
                )}
                <button
                  onClick={() => removeAttachment(i)}
                  className="absolute -right-1.5 -top-1.5 rounded-full bg-red-500 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/csv"
            className="hidden"
            onChange={(e) => { handleFileSelect(e.target.files); e.target.value = ''; }}
          />
          {/* Attach button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="rounded-xl border border-slate-700 bg-slate-800 p-3 text-slate-400 transition-colors hover:border-indigo-500/30 hover:text-white"
            title="Attach image or file"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={attachments.length > 0 ? 'Add a message about the file(s)...' : 'Ask APEX anything about your trading...'}
            rows={1}
            className="flex-1 resize-none rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            style={{ maxHeight: '120px' }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
            }}
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
                imageFiles.forEach(f => dt.items.add(f));
                handleFileSelect(dt.files);
              }
            }}
          />
          <button
            onClick={() => sendMessage()}
            disabled={(!input.trim() && attachments.length === 0) || chatMutation.isPending}
            className="rounded-xl bg-indigo-600 p-3 text-white transition-colors hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 text-[10px] text-slate-600">Images, PDFs, CSV, text files. Paste images with Ctrl+V.</p>
      </div>
    </div>
  );
}
