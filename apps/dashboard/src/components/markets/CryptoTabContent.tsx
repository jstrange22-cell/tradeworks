import { Search } from 'lucide-react';
import type { CryptoTicker } from '@/lib/crypto-api';
import { HotCoinsBar } from './HotCoinsBar';
import { CategoryFilter, type CategoryName } from './CategoryFilter';
import { SortControls, type SortField, type SortDirection } from './SortControls';
import { CryptoMarketRow } from './CryptoMarketRow';

interface CryptoTabContentProps {
  tickers: CryptoTicker[] | null;
  processedTickers: CryptoTicker[];
  isLoading: boolean;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  activeCategory: CategoryName;
  onCategoryChange: (category: CategoryName) => void;
  sortField: SortField;
  onSortFieldChange: (field: SortField) => void;
  sortDirection: SortDirection;
  onSortDirectionToggle: () => void;
}

export function CryptoTabContent({
  tickers,
  processedTickers,
  isLoading,
  searchQuery,
  onSearchChange,
  activeCategory,
  onCategoryChange,
  sortField,
  onSortFieldChange,
  sortDirection,
  onSortDirectionToggle,
}: CryptoTabContentProps) {
  return (
    <>
      <CategoryFilter activeCategory={activeCategory} onCategoryChange={onCategoryChange} />

      {tickers && tickers.length > 0 && <HotCoinsBar tickers={tickers} />}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SortControls
          sortField={sortField}
          sortDirection={sortDirection}
          onSortFieldChange={onSortFieldChange}
          onSortDirectionToggle={onSortDirectionToggle}
        />
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search crypto markets..."
            className="input w-full pl-9"
          />
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {processedTickers.map((ticker, index) => (
          <CryptoMarketRow key={ticker.instrument_name} ticker={ticker} rank={index + 1} />
        ))}
      </div>

      {!tickers && !isLoading && (
        <p className="py-12 text-center text-sm text-slate-500">
          No market data available. Check connection.
        </p>
      )}
      {processedTickers.length === 0 && tickers && tickers.length > 0 && (
        <p className="py-12 text-center text-sm text-slate-500">
          No coins match your filters. Try a different category or search term.
        </p>
      )}
    </>
  );
}
