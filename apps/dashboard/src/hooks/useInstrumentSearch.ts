import { useState, useMemo } from 'react';

const CRYPTO_INSTRUMENTS = [
  'BTC-USD', 'ETH-USD', 'SOL-USD', 'AVAX-USD', 'LINK-USD',
  'DOGE-USD', 'ADA-USD', 'DOT-USD', 'CRO-USD', 'MATIC-USD',
  'XRP-USD', 'UNI-USD', 'AAVE-USD', 'ATOM-USD', 'NEAR-USD',
];

const EQUITY_INSTRUMENTS = [
  'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA',
  'SPY', 'QQQ', 'IWM', 'DIA', 'AMD', 'INTC', 'CRM', 'NFLX',
  'V', 'MA', 'JPM', 'BAC', 'GS', 'WMT', 'HD', 'COST', 'PG',
  'JNJ', 'UNH', 'PFE', 'ABBV', 'MRK', 'LLY',
];

const ALL_INSTRUMENTS = [...CRYPTO_INSTRUMENTS, ...EQUITY_INSTRUMENTS];

export function useInstrumentSearch() {
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    if (!query.trim()) return ALL_INSTRUMENTS.slice(0, 20);
    const upper = query.toUpperCase().trim();
    return ALL_INSTRUMENTS.filter(i => i.toUpperCase().includes(upper)).slice(0, 20);
  }, [query]);

  return { query, setQuery, results, allInstruments: ALL_INSTRUMENTS };
}
