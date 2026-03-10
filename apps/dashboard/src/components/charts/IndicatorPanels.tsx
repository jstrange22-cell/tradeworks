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
