/**
 * Minimal UI primitives for the cockpit. We don't have shadcn/ui in the repo,
 * so this file ships hand-rolled, dependency-free Card / Skeleton / Badge
 * components styled with the existing Tailwind palette.
 */
import type { ReactNode } from 'react';

// ── Card ─────────────────────────────────────────────────────────────────

export function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-slate-700/50 bg-slate-800/40 backdrop-blur-sm ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-700/40 px-4 py-2.5">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
          {title}
        </h3>
        {subtitle ? (
          <p className="mt-0.5 text-[11px] text-slate-500">{subtitle}</p>
        ) : null}
      </div>
      {right}
    </div>
  );
}

export function CardBody({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`p-4 ${className}`}>{children}</div>;
}

// ── Skeleton ─────────────────────────────────────────────────────────────

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      role="status"
      aria-label="loading"
      className={`animate-pulse rounded bg-slate-700/40 ${className}`}
    />
  );
}

// ── Badge ────────────────────────────────────────────────────────────────

export type BadgeTone =
  | 'profit'
  | 'loss'
  | 'neutral'
  | 'warning'
  | 'info'
  | 'crisis';

const BADGE_TONE: Record<BadgeTone, string> = {
  profit: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30',
  loss: 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30',
  neutral: 'bg-slate-500/15 text-slate-300 ring-1 ring-slate-500/30',
  warning: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30',
  info: 'bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30',
  crisis: 'bg-rose-700/25 text-rose-200 ring-1 ring-rose-600/40',
};

export function Badge({
  tone = 'neutral',
  children,
  className = '',
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${BADGE_TONE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

// ── Utility helpers ──────────────────────────────────────────────────────

export function formatUsd(value: number, opts?: { signed?: boolean }): string {
  const sign = opts?.signed && value > 0 ? '+' : '';
  const abs = Math.abs(value);
  // Use compact comma formatting for big numbers, two decimals up to 999,999.
  const formatted = abs >= 100_000
    ? abs.toLocaleString('en-US', { maximumFractionDigits: 0 })
    : abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}${value < 0 ? '-' : ''}$${formatted}`;
}

export function pnlColor(v: number): string {
  if (v > 0) return 'text-emerald-400';
  if (v < 0) return 'text-rose-400';
  return 'text-zinc-300';
}
