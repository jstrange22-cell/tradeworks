/**
 * Collapsible card primitive for the decision detail page.
 *
 * Default-open; user can collapse to scan faster. Renders a header with
 * an icon + label + optional subtitle, and a body. Pure presentation.
 */
import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface DetailCardProps {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: ReactNode;
  rightSlot?: ReactNode;
}

export function DetailCard({
  icon,
  title,
  subtitle,
  defaultOpen = true,
  children,
  rightSlot,
}: DetailCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="card p-0 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between border-b border-transparent px-4 py-3 text-left transition-colors hover:bg-slate-50/40 dark:hover:bg-slate-800/40"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <span className="text-slate-500">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </span>
          {icon}
          <div>
            <div className="text-sm font-semibold text-slate-100">{title}</div>
            {subtitle && <div className="text-xs text-slate-500">{subtitle}</div>}
          </div>
        </div>
        {rightSlot && <div className="flex items-center gap-2">{rightSlot}</div>}
      </button>
      {open && (
        <div className="border-t border-slate-200 px-4 py-3 dark:border-slate-700/50">
          {children}
        </div>
      )}
    </section>
  );
}
