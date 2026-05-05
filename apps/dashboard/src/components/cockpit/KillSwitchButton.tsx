/**
 * Master kill button. Lives top-right on the cockpit. Opens a modal that
 * REQUIRES the user to type "KILL" to enable the confirm action — this is
 * intentional friction. The endpoint flattens every open position.
 *
 * If master kill is already active we render a different state so the user
 * can see the system is in panic mode without an extra click.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';
import type { KillSwitchStatus } from './types';
import { useMasterKillMutation } from './hooks';

interface Props {
  status: KillSwitchStatus | undefined;
}

const REQUIRED_PHRASE = 'KILL';

export function KillSwitchButton({ status }: Props) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const dialogId = useId();
  const inputId = useId();
  const labelId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mutation = useMasterKillMutation();

  const masterActive = status?.master.active === true;

  useEffect(() => {
    if (open) {
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  async function onConfirm() {
    if (confirmText.trim() !== REQUIRED_PHRASE) return;
    try {
      await mutation.mutateAsync({ reason: 'manual UI kill' });
      toast.success('Master kill engaged. All positions flattened.');
      setOpen(false);
      setConfirmText('');
    } catch (err) {
      toast.error(
        `Master kill failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-controls={dialogId}
        className={`group inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 ${
          masterActive
            ? 'bg-rose-700 text-white shadow-[0_0_0_1px_rgba(244,63,94,0.4)] hover:bg-rose-700'
            : 'bg-rose-600/90 text-white shadow-[0_0_0_1px_rgba(244,63,94,0.5)] hover:bg-rose-500'
        }`}
      >
        {masterActive ? (
          <ShieldOff className="h-4 w-4" aria-hidden="true" />
        ) : (
          <AlertTriangle
            className="h-4 w-4 transition-transform group-hover:rotate-3"
            aria-hidden="true"
          />
        )}
        <span>{masterActive ? 'KILL ACTIVE' : 'KILL'}</span>
      </button>

      {open ? (
        <div
          id={dialogId}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelId}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-rose-500/40 bg-slate-900 p-6 shadow-2xl">
            <div className="mb-4 flex items-start gap-3">
              <div className="rounded-lg bg-rose-500/15 p-2 ring-1 ring-rose-500/40">
                <AlertTriangle className="h-5 w-5 text-rose-400" aria-hidden="true" />
              </div>
              <div>
                <h2 id={labelId} className="text-lg font-bold text-white">
                  Engage master kill?
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  This flattens every open position immediately and blocks new
                  entries until you manually clear the kill. Type{' '}
                  <span className="font-mono text-rose-300">{REQUIRED_PHRASE}</span>{' '}
                  to confirm.
                </p>
              </div>
            </div>

            <label htmlFor={inputId} className="sr-only">
              Type {REQUIRED_PHRASE} to confirm
            </label>
            <input
              ref={inputRef}
              id={inputId}
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={`Type ${REQUIRED_PHRASE}`}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-sm text-slate-100 placeholder-slate-600 focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && confirmText.trim() === REQUIRED_PHRASE) {
                  e.preventDefault();
                  void onConfirm();
                }
              }}
            />

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setConfirmText('');
                }}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void onConfirm()}
                disabled={
                  confirmText.trim() !== REQUIRED_PHRASE || mutation.isPending
                }
                className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-rose-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
              >
                {mutation.isPending ? 'Engaging…' : 'Engage kill'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
