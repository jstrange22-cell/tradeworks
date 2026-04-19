interface AllocationSegment {
  market: string;
  percent: number;
  color: string;
}

interface AllocationBarProps {
  segments: AllocationSegment[];
  cashPercent: number;
}

const defaultSegments: AllocationSegment[] = [
  { market: 'Crypto', percent: 25, color: 'bg-orange-500' },
  { market: 'Stocks', percent: 20, color: 'bg-blue-500' },
  { market: 'Predictions', percent: 15, color: 'bg-purple-500' },
  { market: 'Sports', percent: 10, color: 'bg-emerald-500' },
];

export function AllocationBar({ segments = defaultSegments, cashPercent = 30 }: AllocationBarProps) {
  const allSegments = [...segments, { market: 'Cash', percent: cashPercent, color: 'bg-slate-600' }];

  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Capital Allocation</h3>
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-slate-700/50">
        {allSegments.filter(s => s.percent > 0).map((seg) => (
          <div
            key={seg.market}
            className={`${seg.color} transition-all duration-500`}
            style={{ width: `${seg.percent}%` }}
            title={`${seg.market}: ${seg.percent}%`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {allSegments.filter(s => s.percent > 0).map((seg) => (
          <div key={seg.market} className="flex items-center gap-1.5">
            <div className={`h-2 w-2 rounded-full ${seg.color}`} />
            <span className="text-[11px] text-slate-400">{seg.market} {seg.percent}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
