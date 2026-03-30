import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    TradingView?: { widget: new (config: Record<string, unknown>) => void };
  }
}

const TV_INTERVALS: Record<string, string> = {
  '1m': '1',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1h': '60',
  '4h': '240',
  '1d': 'D',
  '1w': 'W',
};

function toTvSymbol(instrument: string): string {
  // "BTC-USD" → "COINBASE:BTCUSD", "ETH-USDT" → "COINBASE:ETHUSDT"
  const [base, quote] = instrument.split('-');
  return `COINBASE:${base}${quote ?? 'USD'}`;
}

interface TradingViewWidgetProps {
  symbol: string;
  timeframe?: string;
  theme?: 'dark' | 'light';
  height?: number;
}

export function TradingViewWidget({
  symbol,
  timeframe = '1h',
  theme = 'dark',
  height = 520,
}: TradingViewWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Give each instance a unique ID
    const containerId = `tv_${symbol.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}`;
    container.id = containerId;

    const interval = TV_INTERVALS[timeframe] ?? '60';

    function initWidget() {
      if (!window.TradingView || !document.getElementById(containerId)) return;
      new window.TradingView.widget({
        autosize: true,
        symbol: toTvSymbol(symbol),
        interval,
        timezone: 'exchange',
        theme,
        style: '1',
        locale: 'en',
        toolbar_bg: theme === 'dark' ? '#0f172a' : '#f1f3f6',
        enable_publishing: false,
        hide_side_toolbar: false,
        allow_symbol_change: true,
        save_image: true,
        container_id: containerId,
        studies: [
          'RSI@tv-basicstudies',
          'MACD@tv-basicstudies',
        ],
        show_popup_button: true,
        popup_width: '1000',
        popup_height: '650',
        withdateranges: true,
        hide_legend: false,
      });
    }

    if (window.TradingView) {
      initWidget();
    } else {
      const existing = document.getElementById('tradingview-script');
      if (existing) {
        // Script already loading — poll until ready
        const poll = setInterval(() => {
          if (window.TradingView) {
            clearInterval(poll);
            initWidget();
          }
        }, 100);
        return () => {
          clearInterval(poll);
          if (container) container.innerHTML = '';
        };
      }
      const script = document.createElement('script');
      script.id = 'tradingview-script';
      script.src = 'https://s3.tradingview.com/tv.js';
      script.async = true;
      script.onload = initWidget;
      document.head.appendChild(script);
    }

    return () => {
      if (container) container.innerHTML = '';
    };
  }, [symbol, timeframe, theme]);

  return (
    <div
      ref={containerRef}
      className="w-full rounded-lg overflow-hidden"
      style={{ height }}
    />
  );
}
