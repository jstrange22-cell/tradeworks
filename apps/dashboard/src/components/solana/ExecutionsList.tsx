import type { SnipeExecution } from '@/types/solana';

interface ExecutionsListProps {
  executions: SnipeExecution[] | undefined;
  title?: string;
}

export function ExecutionsList({ executions, title = 'Recent Executions' }: ExecutionsListProps) {
  const items = executions ?? [];

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700/50 dark:bg-slate-800/50">
      <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-slate-200">{title}</h3>
      <div className="space-y-1.5">
        {items.map((execution) => (
          <div
            key={execution.id}
            className={`flex items-center justify-between rounded-lg border p-2 text-xs ${
              execution.status === 'success' ? 'border-green-500/20 bg-green-500/5'
                : execution.status === 'failed' ? 'border-red-500/20 bg-red-500/5'
                : 'border-gray-200 bg-gray-50 dark:border-slate-700/30 dark:bg-slate-900/20'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className={`font-bold ${execution.action === 'buy' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                {execution.action.toUpperCase()}
              </span>
              <span className="text-gray-900 dark:text-slate-200">{execution.symbol}</span>
              <span className="text-gray-400 dark:text-slate-500">({execution.trigger})</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-gray-500 dark:text-slate-400">{execution.amountSol.toFixed(4)} SOL</span>
              <span className={
                execution.status === 'success' ? 'text-green-600 dark:text-green-400'
                  : execution.status === 'failed' ? 'text-red-600 dark:text-red-400'
                  : 'text-yellow-600 dark:text-yellow-400'
              }>
                {execution.status}
              </span>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div className="py-4 text-center text-gray-400 dark:text-slate-500">No executions yet</div>
        )}
      </div>
    </div>
  );
}
