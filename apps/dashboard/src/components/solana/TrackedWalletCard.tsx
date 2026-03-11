import { TrendingUp, TrendingDown, Trash2 } from 'lucide-react';
import { formatCompact } from '@/components/solana/shared';
import { useWhaleUpdateCopyConfig } from '@/hooks/useSolana';
import type { TrackedWhale } from '@/types/solana';

interface TrackedWalletCardProps {
  whale: TrackedWhale;
  onRemove: (address: string) => void;
}

export function TrackedWalletCard({ whale, onRemove }: TrackedWalletCardProps) {
  const updateCopy = useWhaleUpdateCopyConfig();

  const copyOn = whale.copyTradeEnabled ?? whale.copyConfig?.enabled ?? false;
  const winRate = whale.winRate ?? 0;
  const pnl7d = whale.pnl7d ?? 0;
  const volume = whale.totalVolume ?? 0;
  const txCount = whale.txCount7d ?? whale.totalTxns;

  const handleToggleCopy = () => {
    updateCopy.mutate({ address: whale.address, enabled: !copyOn });
  };

  return (
    <div
      className={`rounded-xl border p-4 transition-colors ${
        copyOn
          ? 'border-green-500/30 bg-green-500/5'
          : 'border-slate-700/50 bg-slate-800/50'
      }`}
    >
      {/* Top: Identity */}
      <div className="mb-3 flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-100 truncate">
              {whale.label}
            </span>
            <span className="font-mono text-[10px] text-slate-500">
              {whale.address.slice(0, 6)}...{whale.address.slice(-4)}
            </span>
          </div>
          {whale.tags && whale.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {whale.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded bg-slate-700/50 px-1.5 py-0.5 text-[10px] text-slate-400"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => onRemove(whale.address)}
          className="ml-2 shrink-0 rounded-lg p-1.5 text-slate-500 transition hover:bg-red-500/10 hover:text-red-400"
          aria-label={`Remove ${whale.label}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Stats row */}
      <div className="mb-3 grid grid-cols-4 gap-2 text-center">
        <StatItem label="Win Rate" value={`${winRate}%`} positive={winRate >= 50} />
        <StatItem label="7D P&L" value={`$${formatCompact(Math.abs(pnl7d))}`} positive={pnl7d >= 0} prefix={pnl7d >= 0 ? '+' : '-'} />
        <StatItem label="Volume" value={`$${formatCompact(volume)}`} />
        <StatItem label="TXs" value={String(txCount)} />
      </div>

      {/* Actions */}
      <button
        onClick={handleToggleCopy}
        disabled={updateCopy.isPending}
        className={`flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
          copyOn
            ? 'bg-green-600/20 text-green-400 hover:bg-green-600/30'
            : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
        }`}
      >
        {copyOn ? (
          <><TrendingUp className="h-3 w-3" /> Copy Trading ON</>
        ) : (
          <><TrendingDown className="h-3 w-3" /> Copy Trading OFF</>
        )}
      </button>
    </div>
  );
}

function StatItem({ label, value, positive, prefix }: {
  label: string;
  value: string;
  positive?: boolean;
  prefix?: string;
}) {
  const color = positive === undefined
    ? 'text-slate-300'
    : positive ? 'text-green-400' : 'text-red-400';

  return (
    <div>
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className={`text-xs font-semibold ${color}`}>
        {prefix}{value}
      </div>
    </div>
  );
}
