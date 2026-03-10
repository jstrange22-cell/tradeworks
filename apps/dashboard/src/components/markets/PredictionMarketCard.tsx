import { Globe } from 'lucide-react';
import type { InstrumentInfo } from '@/hooks/useInstrumentSearch';

interface PredictionMarketCardProps {
  instrument: InstrumentInfo;
}

export function PredictionMarketCard({ instrument }: PredictionMarketCardProps) {
  return (
    <div className="card transition-all hover:border-slate-300 dark:hover:border-slate-600/50">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-500/10">
          <Globe className="h-4 w-4 text-purple-600 dark:text-purple-400" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium leading-snug text-slate-800 dark:text-slate-200">
            {instrument.displayName}
          </h3>
          <div className="mt-2 flex items-center gap-2">
            <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-500/10 dark:text-purple-400">
              PREDICTION
            </span>
            <span className="text-xs text-slate-500">{instrument.exchange}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
