interface ActionItem {
  priority: 'high' | 'medium' | 'low';
  market: string;
  action: string;
  details: string;
}

interface ActionItemsProps {
  items: ActionItem[];
}

const priorityConfig: Record<string, { border: string; dot: string; label: string }> = {
  high: { border: 'border-l-red-500', dot: 'bg-red-500', label: 'HIGH' },
  medium: { border: 'border-l-amber-500', dot: 'bg-amber-500', label: 'MED' },
  low: { border: 'border-l-blue-500', dot: 'bg-blue-500', label: 'LOW' },
};

export function ActionItems({ items }: ActionItemsProps) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4 text-center text-sm text-slate-500">
        No action items — all markets nominal
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Action Items</h3>
      {items.map((item, i) => {
        const config = priorityConfig[item.priority] ?? priorityConfig.low;
        return (
          <div key={i} className={`rounded-lg border-l-[3px] ${config.border} bg-slate-800/50 px-3 py-2.5`}>
            <div className="flex items-center gap-2">
              <div className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
              <span className="rounded bg-slate-700/50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">
                {item.market}
              </span>
              <span className="text-sm font-medium text-white">{item.action}</span>
            </div>
            <p className="mt-0.5 pl-3.5 text-xs text-slate-400">{item.details}</p>
          </div>
        );
      })}
    </div>
  );
}
