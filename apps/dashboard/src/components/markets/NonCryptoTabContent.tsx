import type { ReactNode } from 'react';
import { Loader2, Search } from 'lucide-react';
import type { InstrumentInfo } from '@/hooks/useInstrumentSearch';

interface NonCryptoTabContentProps {
  loading: boolean;
  items: InstrumentInfo[];
  totalItems: number;
  maxDisplay: number;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  placeholder: string;
  emptyLabel: string;
  loadingLabel: string;
  connectCard: ReactNode;
  renderItem: (instrument: InstrumentInfo) => ReactNode;
}

export function NonCryptoTabContent({
  loading,
  items,
  totalItems,
  maxDisplay,
  searchQuery,
  onSearchChange,
  placeholder,
  emptyLabel,
  loadingLabel,
  connectCard,
  renderItem,
}: NonCryptoTabContentProps) {
  return (
    <>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
        <input
          type="text"
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={placeholder}
          className="input w-full pl-9"
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {loading && (
          <div className="col-span-full flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-blue-600 dark:text-blue-400" />
            <span className="ml-2 text-sm text-slate-500 dark:text-slate-400">{loadingLabel}</span>
          </div>
        )}
        {!loading && items.length > 0 && (
          <>
            {connectCard}
            {items.slice(0, maxDisplay).map(renderItem)}
            {totalItems > maxDisplay && (
              <div className="col-span-full py-2 text-center text-xs text-slate-500">
                Showing {maxDisplay} of {totalItems} items. Use search to narrow results.
              </div>
            )}
          </>
        )}
        {!loading && items.length === 0 && (
          <div className="col-span-full py-8 text-center text-sm text-slate-500">
            {searchQuery ? `No ${emptyLabel} match your search.` : `No ${emptyLabel} available.`}
          </div>
        )}
      </div>
    </>
  );
}
