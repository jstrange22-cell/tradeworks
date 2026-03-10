interface RsiPanelProps {
  value: number;
}

export function RsiPanel({ value }: RsiPanelProps) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-400">RSI (14)</span>
        <span className={`text-lg font-bold ${
          value > 70 ? 'text-red-400' : value < 30 ? 'text-green-400' : 'text-slate-200'
        }`}>
          {value.toFixed(1)}
        </span>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-slate-800">
        <div
          className={`h-1.5 rounded-full transition-all ${
            value > 70 ? 'bg-red-500' : value < 30 ? 'bg-green-500' : 'bg-purple-500'
          }`}
          style={{ width: `${value}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-600">
        <span>Oversold</span>
        <span>{value > 70 ? 'OVERBOUGHT' : value < 30 ? 'OVERSOLD' : 'Neutral'}</span>
        <span>Overbought</span>
      </div>
    </div>
  );
}

interface MacdPanelProps {
  values: { macd: number; signal: number; histogram: number };
}

export function MacdPanel({ values }: MacdPanelProps) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
      <div className="text-xs font-semibold text-slate-400 mb-2">MACD (12, 26, 9)</div>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <div className="text-[10px] text-slate-600">MACD</div>
          <div className={`text-sm font-bold ${values.macd >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {values.macd.toFixed(2)}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-600">Signal</div>
          <div className="text-sm font-bold text-blue-400">
            {values.signal.toFixed(2)}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-600">Histogram</div>
          <div className={`text-sm font-bold ${values.histogram >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {values.histogram.toFixed(2)}
          </div>
        </div>
      </div>
      <div className="mt-2 text-center text-[10px] font-semibold">
        <span className={values.macd > values.signal ? 'text-green-400' : 'text-red-400'}>
          {values.macd > values.signal ? 'BULLISH CROSSOVER' : 'BEARISH CROSSOVER'}
        </span>
      </div>
    </div>
  );
}

/* ── Stochastic Panel ── */

interface StochasticPanelProps {
  values: { k: number; d: number };
}

export function StochasticPanel({ values }: StochasticPanelProps) {
  const zone = values.k > 80
    ? 'OVERBOUGHT'
    : values.k < 20
      ? 'OVERSOLD'
      : 'Neutral';

  const zoneColor = values.k > 80
    ? 'text-red-400'
    : values.k < 20
      ? 'text-green-400'
      : 'text-slate-200';

  const crossSignal = values.k > values.d ? 'BULLISH' : 'BEARISH';
  const crossColor = values.k > values.d ? 'text-green-400' : 'text-red-400';

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
      <div className="text-xs font-semibold text-slate-400 mb-2">Stochastic (14, 3)</div>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <div className="text-[10px] text-slate-600">%K</div>
          <div className={`text-sm font-bold ${zoneColor}`}>
            {values.k.toFixed(1)}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-600">%D</div>
          <div className="text-sm font-bold text-yellow-400">
            {values.d.toFixed(1)}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-600">Zone</div>
          <div className={`text-sm font-bold ${zoneColor}`}>
            {zone}
          </div>
        </div>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-slate-800">
        <div
          className={`h-1.5 rounded-full transition-all ${
            values.k > 80 ? 'bg-red-500' : values.k < 20 ? 'bg-green-500' : 'bg-yellow-500'
          }`}
          style={{ width: `${Math.min(Math.max(values.k, 0), 100)}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-600">
        <span>Oversold (20)</span>
        <span className={`font-semibold ${crossColor}`}>{crossSignal} CROSS</span>
        <span>Overbought (80)</span>
      </div>
    </div>
  );
}

/* ── CCI Panel ── */

interface CciPanelProps {
  value: number;
}

export function CciPanel({ value }: CciPanelProps) {
  const zone = value > 100
    ? 'OVERBOUGHT'
    : value < -100
      ? 'OVERSOLD'
      : 'Neutral';

  const zoneColor = value > 100
    ? 'text-red-400'
    : value < -100
      ? 'text-green-400'
      : 'text-slate-200';

  // Normalize CCI to a 0-100 bar width (CCI typically ranges -200 to +200)
  const normalizedWidth = Math.min(Math.max((value + 200) / 4, 0), 100);

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-400">CCI (20)</span>
        <span className={`text-lg font-bold ${zoneColor}`}>
          {value.toFixed(1)}
        </span>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-slate-800">
        <div
          className={`h-1.5 rounded-full transition-all ${
            value > 100 ? 'bg-red-500' : value < -100 ? 'bg-green-500' : 'bg-orange-500'
          }`}
          style={{ width: `${normalizedWidth}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-600">
        <span>-100 (Oversold)</span>
        <span className={`font-semibold ${zoneColor}`}>{zone}</span>
        <span>+100 (Overbought)</span>
      </div>
    </div>
  );
}

/* ── OBV Panel ── */

interface ObvPanelProps {
  values: { current: number; previous: number; trend: 'rising' | 'falling' | 'flat' };
}

export function ObvPanel({ values }: ObvPanelProps) {
  const trendConfig = {
    rising: { label: 'RISING', color: 'text-green-400', bgColor: 'bg-green-500', arrow: '\u2191' },
    falling: { label: 'FALLING', color: 'text-red-400', bgColor: 'bg-red-500', arrow: '\u2193' },
    flat: { label: 'FLAT', color: 'text-slate-400', bgColor: 'bg-slate-500', arrow: '\u2192' },
  } as const;

  const config = trendConfig[values.trend];

  const formatObv = (val: number): string => {
    const abs = Math.abs(val);
    if (abs >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(2)}B`;
    if (abs >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
    return val.toFixed(0);
  };

  const change = values.current - values.previous;
  const changePct = values.previous !== 0
    ? ((change / Math.abs(values.previous)) * 100)
    : 0;

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
      <div className="text-xs font-semibold text-slate-400 mb-2">On-Balance Volume</div>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <div className="text-[10px] text-slate-600">OBV</div>
          <div className="text-sm font-bold text-slate-200">
            {formatObv(values.current)}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-600">Change</div>
          <div className={`text-sm font-bold ${change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-600">Trend</div>
          <div className={`text-sm font-bold ${config.color}`}>
            {config.arrow} {config.label}
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-center gap-1.5">
        <div className={`h-2 w-2 rounded-full ${config.bgColor} animate-pulse`} />
        <span className={`text-[10px] font-semibold ${config.color}`}>
          Volume {values.trend === 'rising' ? 'confirming price' : values.trend === 'falling' ? 'diverging from price' : 'neutral momentum'}
        </span>
      </div>
    </div>
  );
}
