/**
 * QuickActions — preset prompt chips that send templated queries to APEX.
 *
 * Each action either:
 *   - Sends a static prompt (`prompt`), or
 *   - Calls `onCustom` to let the parent build a contextual prompt
 *     (e.g. picking a recent vetoed signal, or a strategy name).
 *
 * Keep this list short — too many chips becomes noise. Pin the high-signal
 * questions Jason actually asks during a session.
 */

import {
  AlertOctagon,
  Flame,
  PauseCircle,
  ShieldAlert,
  ThumbsDown,
  Sparkles,
} from 'lucide-react';
import type { ComponentType } from 'react';

interface QuickAction {
  id: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
  prompt?: string;
  /** When set, parent handles building the prompt (typically via a picker). */
  custom?: 'why-veto' | 'pause-strategy';
}

const ACTIONS: QuickAction[] = [
  {
    id: 'why-veto',
    label: 'Why veto?',
    Icon: ThumbsDown,
    custom: 'why-veto',
  },
  {
    id: 'heat',
    label: 'Portfolio heat?',
    Icon: Flame,
    prompt: "What's my current portfolio heat?",
  },
  {
    id: 'losers',
    label: 'Top losers today',
    Icon: AlertOctagon,
    prompt: 'Show me my biggest losing trades today and what we should learn from them.',
  },
  {
    id: 'pause-strategy',
    label: 'Pause strategy',
    Icon: PauseCircle,
    custom: 'pause-strategy',
  },
  {
    id: 'kill-switches',
    label: 'Kill switch status',
    Icon: ShieldAlert,
    prompt: 'Run the kill_switch_status tool and summarise the current state.',
  },
  {
    id: 'morning-brief',
    label: 'Morning brief',
    Icon: Sparkles,
    prompt: 'Morning brief — top 5 opportunities across all markets right now.',
  },
];

interface QuickActionsProps {
  onPrompt: (prompt: string) => void;
  onCustom: (kind: 'why-veto' | 'pause-strategy') => void;
  disabled?: boolean;
}

export function QuickActions({ onPrompt, onCustom, disabled }: QuickActionsProps) {
  return (
    <div
      className="flex flex-wrap gap-1.5 px-3 pb-2 pt-1"
      role="toolbar"
      aria-label="Quick actions"
    >
      {ACTIONS.map(({ id, label, Icon, prompt, custom }) => (
        <button
          key={id}
          type="button"
          disabled={disabled}
          onClick={() => {
            if (custom) onCustom(custom);
            else if (prompt) onPrompt(prompt);
          }}
          className="group flex items-center gap-1.5 rounded-full border border-slate-700/50 bg-slate-800/60 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition-colors hover:border-indigo-500/40 hover:bg-slate-800 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Icon className="h-3 w-3 text-indigo-300 group-hover:text-indigo-200" />
          {label}
        </button>
      ))}
    </div>
  );
}
