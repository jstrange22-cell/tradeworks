import { useState } from 'react';
import { Users, ChevronDown, ChevronRight, Copy } from 'lucide-react';
import { useWhaleDiscover, useWhaleQuickCopy } from '@/hooks/useSolana';

export function DiscoverTraders() {
  const [open, setOpen] = useState(true);
  const discover = useWhaleDiscover(true);
  const quickCopy = useWhaleQuickCopy();

  const traders = discover.data?.data ?? [];

  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/50">
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center gap-2 p-4 text-left"
        aria-expanded={open}
      >
        <Users className="h-4 w-4 text-purple-400" />
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-slate-200">Explore Traders</h3>
          <p className="text-[10px] text-slate-500">Notable Solana wallets</p>
        </div>
        <span className="rounded-full bg-slate-700 px-2 py-0.5 text-[10px] text-slate-400">
          {traders.length}
        </span>
        {open
          ? <ChevronDown className="h-4 w-4 text-slate-500" />
          : <ChevronRight className="h-4 w-4 text-slate-500" />}
      </button>

      {open && (
        <div className="border-t border-slate-700/50 p-4 pt-3">
          {traders.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-500">
              No traders discovered yet
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {traders.map((trader) => (
                <div
                  key={trader.address}
                  className="flex items-center justify-between rounded-lg border border-slate-700/30 bg-slate-900/30 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-200 truncate">
                        {trader.label}
                      </span>
                      <span className="font-mono text-[10px] text-slate-500">
                        {trader.address.slice(0, 6)}...{trader.address.slice(-4)}
                      </span>
                    </div>
                    {trader.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {trader.tags.map((tag) => (
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

                  {trader.isTracked ? (
                    <span className="ml-3 shrink-0 cursor-default rounded-lg bg-slate-700 px-3 py-1.5 text-xs text-slate-400">
                      Tracking
                    </span>
                  ) : (
                    <button
                      onClick={() => quickCopy.mutate({ address: trader.address, label: trader.label })}
                      disabled={quickCopy.isPending}
                      className="ml-3 flex shrink-0 items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-green-500 disabled:opacity-50"
                    >
                      <Copy className="h-3 w-3" />
                      Copy
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
