/**
 * Lightweight JSON-ish renderer with a copy button. For decision detail
 * pages we want pretty-printed but compact — full pretty is too large
 * for nested portfolio/news blobs, so we fall back to a max-height
 * scrollable block.
 */
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface JsonViewProps {
  value: unknown;
  emptyText?: string;
  maxHeightClass?: string;
}

export function JsonView({
  value,
  emptyText = 'No data recorded',
  maxHeightClass = 'max-h-72',
}: JsonViewProps) {
  const [copied, setCopied] = useState(false);

  if (value === null || value === undefined) {
    return <div className="text-sm italic text-slate-500">{emptyText}</div>;
  }

  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable; ignore
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleCopy}
        className="absolute right-2 top-2 inline-flex items-center gap-1 rounded border border-slate-200/70 bg-white/80 px-2 py-1 text-[10px] uppercase tracking-wider text-slate-500 backdrop-blur hover:text-slate-300 dark:border-slate-700/50 dark:bg-slate-900/70"
        aria-label="Copy JSON"
      >
        {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre
        className={`${maxHeightClass} overflow-auto rounded-md border border-slate-200 bg-slate-50/60 p-3 font-mono text-[11px] leading-relaxed text-slate-700 dark:border-slate-700/50 dark:bg-slate-950/60 dark:text-slate-300`}
      >
        {text}
      </pre>
    </div>
  );
}
