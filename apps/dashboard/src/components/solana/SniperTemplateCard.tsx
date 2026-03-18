import { Play, Square, Pencil, Trash2 } from 'lucide-react';
import { formatCompact } from '@/components/solana/shared';
import type { TemplateStatusItem } from '@/types/solana';

interface SniperTemplateCardProps {
  template: TemplateStatusItem;
  onToggle: (id: string, running: boolean) => void;
  onEdit: (template: TemplateStatusItem) => void;
  onDelete: (id: string) => void;
  isToggling: boolean;
  isDeleting: boolean;
}

export function SniperTemplateCard({
  template,
  onToggle,
  onEdit,
  onDelete,
  isToggling,
  isDeleting,
}: SniperTemplateCardProps) {
  const { stats } = template;
  const winRate = stats.totalTrades > 0
    ? ((stats.wins / stats.totalTrades) * 100).toFixed(1)
    : '0.0';
  const pnlColor = stats.totalPnlSol >= 0 ? 'text-green-400' : 'text-red-400';
  const isDefault = template.name.toLowerCase() === 'default';

  return (
    <div
      className={`rounded-xl border p-4 bg-slate-800/50 transition-colors ${
        template.running
          ? 'border-green-500/30'
          : 'border-slate-700/50'
      }`}
    >
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-100 truncate max-w-[160px]">
            {template.name}
          </span>
          <span
            className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
              template.running
                ? 'bg-green-500/20 text-green-400'
                : 'bg-slate-700 text-slate-500'
            }`}
          >
            {template.running ? 'ACTIVE' : 'STOPPED'}
          </span>
          {template.paperMode && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-amber-500/20 text-amber-400">
              PAPER
            </span>
          )}
          {template.circuitBreakerPausedUntil != null && template.circuitBreakerPausedUntil > Date.now() && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-red-500/20 text-red-400">
              PAUSED
            </span>
          )}
        </div>
        <button
          onClick={() => onToggle(template.id, template.running)}
          disabled={isToggling}
          aria-label={template.running ? `Stop ${template.name}` : `Start ${template.name}`}
          className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-opacity disabled:opacity-50 ${
            template.running
              ? 'bg-red-600 text-white hover:bg-red-700'
              : 'bg-green-600 text-white hover:bg-green-700'
          }`}
        >
          {template.running
            ? <><Square className="h-3 w-3" /> Stop</>
            : <><Play className="h-3 w-3" /> Start</>}
        </button>
      </div>

      {/* Mini Stats */}
      <div className={`mb-3 grid gap-2 ${template.paperMode ? 'grid-cols-5' : 'grid-cols-4'}`}>
        {[
          { label: 'Trades', value: String(stats.totalTrades) },
          { label: 'Win Rate', value: `${winRate}%` },
          { label: 'P&L', value: `${stats.totalPnlSol >= 0 ? '+' : ''}${stats.totalPnlSol.toFixed(4)}` },
          { label: 'Daily', value: `${template.dailySpentSol.toFixed(2)}/${template.dailyBudgetSol}` },
          ...(template.paperMode && template.paperBalanceSol != null
            ? [{ label: 'Paper SOL', value: template.paperBalanceSol.toFixed(4) }]
            : []),
        ].map((stat) => (
          <div key={stat.label} className="text-center">
            <div className="text-[10px] text-slate-500">{stat.label}</div>
            <div className={`text-xs font-mono font-medium ${
              stat.label === 'P&L' ? pnlColor : 'text-slate-200'
            }`}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {/* Config Summary */}
      <div className="mb-3 flex flex-wrap gap-1.5 text-[10px] text-slate-400">
        <span className="rounded bg-slate-700/60 px-1.5 py-0.5">Buy: {template.buyAmountSol} SOL</span>
        <span className="rounded bg-slate-700/60 px-1.5 py-0.5">TP: +{template.takeProfitPercent}%</span>
        <span className="rounded bg-slate-700/60 px-1.5 py-0.5">SL: {template.stopLossPercent}%</span>
        <span className="rounded bg-slate-700/60 px-1.5 py-0.5">MCap: ${formatCompact(template.maxMarketCapUsd)}</span>
      </div>

      {/* Feature Chips + Actions */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5">
          {template.autoBuyPumpFun && (
            <span className="rounded-full bg-purple-500/20 px-2 py-0.5 text-[10px] font-medium text-purple-400">
              pump.fun
            </span>
          )}
          {template.autoBuyTrending && (
            <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] font-medium text-blue-400">
              trending
            </span>
          )}
          {template.pendingTokens != null && template.pendingTokens > 0 && (
            <span className="rounded-full bg-cyan-500/20 px-2 py-0.5 text-[10px] font-medium text-cyan-400">
              {template.pendingTokens} observing
            </span>
          )}
          {template.consecutiveLosses != null && template.consecutiveLosses > 0 && (
            <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-medium text-red-400">
              {template.consecutiveLosses} losses
            </span>
          )}
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => onEdit(template)}
            aria-label={`Edit ${template.name}`}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-700 hover:text-slate-200 transition-colors"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onDelete(template.id)}
            disabled={isDefault || isDeleting}
            aria-label={`Delete ${template.name}`}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-red-900/30 hover:text-red-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
