/**
 * ToolCallCard — visual surface for a single tool invocation embedded in a
 * message. Lifecycle: pending → (confirm if mutating) → running → done | error.
 *
 * For mutating tools (kill switches, pauses) the card requires an explicit
 * "Confirm" click before invoking the gateway endpoint.
 */

import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Wrench,
  XCircle,
  ShieldAlert,
} from 'lucide-react';
import { useChatHistory, type ChatToolCall } from './ChatHistoryStore';
import { invokeTool } from './ToolRegistry';

interface ToolCallCardProps {
  messageId: string;
  toolCall: ChatToolCall;
  /** Called after a tool result is written back so the chat can request a follow-up reply. */
  onResolved?: (result: unknown, error?: string) => void;
}

const STATUS_LABEL: Record<ChatToolCall['status'], string> = {
  pending: 'Awaiting confirmation',
  running: 'Running…',
  done: 'Completed',
  error: 'Failed',
  vetoed: 'Vetoed by user',
};

export function ToolCallCard({ messageId, toolCall, onResolved }: ToolCallCardProps) {
  const patchMessage = useChatHistory((s) => s.patchMessage);
  const [busy, setBusy] = useState(false);

  const isMutating = toolCall.requiresConfirmation;
  const isPending = toolCall.status === 'pending';
  const isDone = toolCall.status === 'done';
  const isError = toolCall.status === 'error';
  const isVetoed = toolCall.status === 'vetoed';

  async function runTool() {
    if (busy || isDone || isError || isVetoed) return;
    setBusy(true);
    await patchMessage(messageId, {
      toolCall: { ...toolCall, status: 'running' },
    });
    const res = await invokeTool(toolCall.tool, toolCall.args);
    const next: ChatToolCall = res.error
      ? { ...toolCall, status: 'error', error: res.error, result: res.details }
      : { ...toolCall, status: 'done', result: res.data };
    await patchMessage(messageId, { toolCall: next });
    setBusy(false);
    onResolved?.(res.data, res.error);
  }

  async function vetoTool() {
    if (isDone || isError || isVetoed) return;
    await patchMessage(messageId, { toolCall: { ...toolCall, status: 'vetoed' } });
    onResolved?.(null, 'User vetoed tool invocation.');
  }

  // Auto-run for non-mutating tools when first rendered. We use a ref-effect
  // pattern via setState/conditional invocation: if it's pending and safe, fire.
  // (Don't put this in useEffect — we only want it to fire from the first
  // render-with-pending state, and we don't want a stale-closure re-run.)
  if (toolCall.status === 'pending' && !isMutating && !busy) {
    // Defer so we don't update state during render
    queueMicrotask(() => { void runTool(); });
  }

  const accent = isError
    ? 'border-rose-500/40 bg-rose-500/5'
    : isMutating && isPending
      ? 'border-amber-500/40 bg-amber-500/5'
      : isDone
        ? 'border-emerald-500/30 bg-emerald-500/5'
        : 'border-slate-700/50 bg-slate-800/40';

  return (
    <div
      className={`rounded-xl border px-3 py-2 ${accent}`}
      role="region"
      aria-label={`Tool call: ${toolCall.tool}`}
    >
      <header className="flex items-center gap-2">
        <Wrench className="h-3.5 w-3.5 text-indigo-300" aria-hidden="true" />
        <span className="font-mono text-[12px] font-semibold text-indigo-200">
          {toolCall.tool}
        </span>
        <StatusBadge status={toolCall.status} busy={busy} />
      </header>

      {Object.keys(toolCall.args).length > 0 && (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-slate-400 hover:text-slate-200">
            Arguments
          </summary>
          <pre className="mt-1 overflow-x-auto rounded bg-slate-900/60 p-2 text-[11px] leading-snug text-slate-300">
            {JSON.stringify(toolCall.args, null, 2)}
          </pre>
        </details>
      )}

      {isMutating && isPending && (
        <div className="mt-2 flex items-start gap-2 rounded-md bg-amber-500/10 p-2 text-[11px] text-amber-200 ring-1 ring-amber-500/30">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            This tool will <strong>change live state</strong>. APEX is asking permission before
            invoking it.
          </p>
        </div>
      )}

      {(isPending && isMutating) && (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => { void runTool(); }}
            disabled={busy}
            className="rounded-md bg-rose-600 px-3 py-1 text-[11px] font-semibold text-white shadow-sm hover:bg-rose-500 disabled:opacity-50"
            aria-label={`Confirm ${toolCall.tool}`}
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={() => { void vetoTool(); }}
            className="rounded-md bg-slate-700 px-3 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-600"
          >
            Cancel
          </button>
        </div>
      )}

      {isError && toolCall.error && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-rose-300">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          {toolCall.error}
        </p>
      )}

      {isDone && toolCall.result !== undefined && (
        <details className="mt-2" open>
          <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-emerald-300 hover:text-emerald-200">
            Result
          </summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded bg-slate-900/60 p-2 text-[11px] leading-snug text-slate-200">
            {typeof toolCall.result === 'string'
              ? toolCall.result
              : JSON.stringify(toolCall.result, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

function StatusBadge({ status, busy }: { status: ChatToolCall['status']; busy: boolean }) {
  const Icon =
    status === 'done'
      ? CheckCircle2
      : status === 'error'
        ? XCircle
        : status === 'vetoed'
          ? XCircle
          : busy || status === 'running'
            ? Loader2
            : AlertTriangle;
  const cls =
    status === 'done'
      ? 'text-emerald-300'
      : status === 'error' || status === 'vetoed'
        ? 'text-rose-300'
        : busy || status === 'running'
          ? 'text-indigo-300 animate-spin'
          : 'text-amber-300';
  return (
    <span className="ml-auto flex items-center gap-1 text-[10px] font-medium text-slate-300">
      <Icon className={`h-3 w-3 ${cls}`} aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}
