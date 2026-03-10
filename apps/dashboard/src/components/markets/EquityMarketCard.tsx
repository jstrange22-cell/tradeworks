import type { InstrumentInfo } from '@/hooks/useInstrumentSearch';

interface EquityMarketCardProps {
  instrument: InstrumentInfo;
}

export function EquityMarketCard({ instrument }: EquityMarketCardProps) {
  return (
    <div className="card transition-all hover:border-slate-300 dark:hover:border-slate-600/50">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            {instrument.symbol}
          </h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {instrument.displayName}
          </p>
        </div>
        <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-400">
          EQUITY
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
        <span className="capitalize">{instrument.exchange}</span>
        {instrument.tradable && (
          <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] text-green-700 dark:bg-green-500/10 dark:text-green-400">
            Tradable
          </span>
        )}
      </div>
    </div>
  );
}
