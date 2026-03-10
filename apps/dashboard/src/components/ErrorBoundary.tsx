import { ErrorBoundary as ReactErrorBoundary } from 'react-error-boundary';
import { AlertTriangle, RotateCcw } from 'lucide-react';

function ErrorFallback({ error, resetErrorBoundary }: { error: unknown; resetErrorBoundary: (...args: unknown[]) => void }) {
  const message = error instanceof Error ? error.message : 'An unexpected error occurred';
  return (
    <div className="flex flex-col items-center justify-center min-h-[200px] p-6 rounded-lg border border-red-500/30 bg-red-500/5">
      <AlertTriangle className="h-10 w-10 text-red-400 mb-3" />
      <h3 className="text-lg font-semibold text-red-400 mb-1">Something went wrong</h3>
      <p className="text-sm text-slate-400 mb-4 max-w-md text-center">
        {message}
      </p>
      <button
        onClick={resetErrorBoundary}
        className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm text-slate-200 transition-colors"
      >
        <RotateCcw className="h-4 w-4" />
        Try again
      </button>
    </div>
  );
}

export function PageErrorBoundary({ children }: { children: React.ReactNode }) {
  return (
    <ReactErrorBoundary
      FallbackComponent={ErrorFallback}
      onError={(error) => {
        console.error('[TradeWorks] Page error:', error);
      }}
    >
      {children}
    </ReactErrorBoundary>
  );
}

export function WidgetErrorBoundary({ children, name }: { children: React.ReactNode; name?: string }) {
  return (
    <ReactErrorBoundary
      fallback={
        <div className="flex items-center gap-2 p-4 rounded-lg border border-red-500/20 bg-red-500/5 text-sm text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{name ? `${name} failed to load` : 'Widget failed to load'}</span>
        </div>
      }
      onError={(error) => {
        console.error(`[TradeWorks] Widget error${name ? ` (${name})` : ''}:`, error);
      }}
    >
      {children}
    </ReactErrorBoundary>
  );
}
