import type { CryptoTicker } from '@/lib/crypto-api';
import { CATEGORIES, type CategoryName } from './CategoryFilter';
import type { SortField, SortDirection } from './SortControls';

export function extractSymbol(instrumentName: string): string {
  return instrumentName.replace(/_USDT$/, '').replace(/-USD$/, '');
}

export function applyCategoryFilter(
  tickers: CryptoTicker[],
  category: CategoryName,
): CryptoTicker[] {
  if (category === 'All') return tickers;
  const allowed = CATEGORIES[category];
  if (!allowed) return tickers;
  return tickers.filter((ticker) => {
    const symbol = extractSymbol(ticker.instrument_name);
    return allowed.includes(symbol);
  });
}

export function applySorting(
  tickers: CryptoTicker[],
  field: SortField,
  direction: SortDirection,
): CryptoTicker[] {
  const sorted = [...tickers];

  sorted.sort((tickerA, tickerB) => {
    let comparison = 0;

    switch (field) {
      case 'volume':
        comparison = parseFloat(tickerA.volume_value) - parseFloat(tickerB.volume_value);
        break;
      case 'change':
        comparison = parseFloat(tickerA.change) - parseFloat(tickerB.change);
        break;
      case 'price':
        comparison = parseFloat(tickerA.last) - parseFloat(tickerB.last);
        break;
      case 'name':
        comparison = extractSymbol(tickerA.instrument_name)
          .localeCompare(extractSymbol(tickerB.instrument_name));
        break;
    }

    return direction === 'asc' ? comparison : -comparison;
  });

  return sorted;
}
