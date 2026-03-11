import { Activity, Copy } from 'lucide-react';
import { formatCompact } from '@/components/solana/shared';
import type { WhaleActivity } from '@/types/solana';

interface WhaleActivityFeedProps {
  activity: WhaleActivity[];
}

export function WhaleActivityFeed({ activity }: WhaleActivityFeedProps) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
        <Activity className="h-4 w-4 text-cyan-400" />
        Activity Feed
        {activity.length > 0 && (
          <span className="rounded-full bg-slate-700 px-2 py-0.5 text-[10px] text-slate-400">
            {activity.length}
          </span>
        )}
      </h3>

      <div className="space-y-1.5">
        {activity.map((item) => {
          const isBuy = item.type === 'buy';
          return (
            <div
              key={item.id}
              className={`flex items-center justify-between rounded-lg border p-2 text-xs ${
                isBuy
                  ? 'border-green-500/20 bg-green-500/5'
                  : 'border-red-500/20 bg-red-500/5'
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`font-bold ${isBuy ? 'text-green-400' : 'text-red-400'}`}
                >
                  {item.type.toUpperCase()}
                </span>
                <span className="font-medium text-slate-200">
                  {item.tokenSymbol}
                </span>
                <span className="text-slate-500">by {item.whaleLabel}</span>
                {item.copied && (
                  <span title="Copy-traded">
                    <Copy className="h-3 w-3 text-cyan-400" />
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-slate-300">
                  ${formatCompact(item.amountUsd)}
                </span>
                <span className="text-[10px] text-slate-500">
                  {new Date(item.timestamp).toLocaleTimeString()}
                </span>
              </div>
            </div>
          );
        })}

        {activity.length === 0 && (
          <p className="py-4 text-center text-slate-500">
            No whale activity detected yet
          </p>
        )}
      </div>
    </div>
  );
}
