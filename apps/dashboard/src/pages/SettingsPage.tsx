import { useState } from 'react';
import { Settings, Eye, EyeOff, Save } from 'lucide-react';
import { usePortfolioStore } from '@/stores/portfolio-store';

export function SettingsPage() {
  const { paperTrading, setPaperTrading } = usePortfolioStore();

  // Risk limits form state
  const [riskPerTrade, setRiskPerTrade] = useState('1.0');
  const [dailyLossCap, setDailyLossCap] = useState('3.0');
  const [weeklyLossCap, setWeeklyLossCap] = useState('7.0');
  const [maxPortfolioHeat, setMaxPortfolioHeat] = useState('6.0');
  const [minRiskReward, setMinRiskReward] = useState('3.0');
  const [maxCorrelation, setMaxCorrelation] = useState('40');

  // API keys state
  const [showCoinbaseKey, setShowCoinbaseKey] = useState(false);
  const [showAlpacaKey, setShowAlpacaKey] = useState(false);
  const [showPolymarketKey, setShowPolymarketKey] = useState(false);
  const coinbaseKey = 'cb_live_xxxxxxxxxxxxxxxxxxxxx';
  const alpacaKey = 'PKXXXXXXXXXXXXXXXXXX';
  const polymarketKey = '0x1234...abcd';

  // Engine settings
  const [cycleInterval, setCycleInterval] = useState('600');
  const [notifyOnTrade, setNotifyOnTrade] = useState(true);
  const [notifyOnCircuitBreaker, setNotifyOnCircuitBreaker] = useState(true);
  const [notifyOnError, setNotifyOnError] = useState(true);
  const [notifyOnDailyReport, setNotifyOnDailyReport] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="h-6 w-6 text-blue-400" />
        <h1 className="text-2xl font-bold text-slate-100">Settings</h1>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Trading Mode */}
        <div className="card">
          <div className="card-header">Trading Mode</div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-slate-200">
                Paper / Live Toggle
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Paper mode simulates trades without real money. Switch to Live
                mode when ready for production.
              </div>
            </div>
            <button
              onClick={() => setPaperTrading(!paperTrading)}
              className={`relative inline-flex h-8 w-16 items-center rounded-full transition-colors ${
                paperTrading ? 'bg-amber-600' : 'bg-blue-600'
              }`}
            >
              <span
                className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                  paperTrading ? 'translate-x-1.5' : 'translate-x-8'
                }`}
              />
            </button>
          </div>
          <div
            className={`mt-3 rounded-lg px-3 py-2 text-sm font-medium ${
              paperTrading
                ? 'bg-amber-500/10 text-amber-400'
                : 'bg-blue-500/10 text-blue-400'
            }`}
          >
            Currently: {paperTrading ? 'PAPER TRADING' : 'LIVE TRADING'}
          </div>
        </div>

        {/* Engine Cycle Interval */}
        <div className="card">
          <div className="card-header">Engine Configuration</div>
          <div>
            <label className="text-sm font-medium text-slate-200">
              Cycle Interval (seconds)
            </label>
            <p className="mt-0.5 text-xs text-slate-500">
              How often the engine runs a full analysis + trade cycle.
            </p>
            <input
              type="number"
              value={cycleInterval}
              onChange={(e) => setCycleInterval(e.target.value)}
              className="input mt-2 w-full"
              min="60"
              max="3600"
              step="60"
            />
          </div>
          <div className="mt-3 text-xs text-slate-500">
            Current: every {Math.floor(Number(cycleInterval) / 60)} minutes
          </div>
        </div>

        {/* Risk Limits */}
        <div className="card lg:col-span-2">
          <div className="card-header">Risk Limits</div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="text-xs font-medium text-slate-400">
                Max Risk per Trade (%)
              </label>
              <input
                type="number"
                value={riskPerTrade}
                onChange={(e) => setRiskPerTrade(e.target.value)}
                className="input mt-1 w-full"
                step="0.1"
                min="0.1"
                max="5"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400">
                Daily Loss Cap (%)
              </label>
              <input
                type="number"
                value={dailyLossCap}
                onChange={(e) => setDailyLossCap(e.target.value)}
                className="input mt-1 w-full"
                step="0.5"
                min="1"
                max="10"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400">
                Weekly Loss Cap (%)
              </label>
              <input
                type="number"
                value={weeklyLossCap}
                onChange={(e) => setWeeklyLossCap(e.target.value)}
                className="input mt-1 w-full"
                step="0.5"
                min="2"
                max="20"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400">
                Max Portfolio Heat (%)
              </label>
              <input
                type="number"
                value={maxPortfolioHeat}
                onChange={(e) => setMaxPortfolioHeat(e.target.value)}
                className="input mt-1 w-full"
                step="0.5"
                min="1"
                max="15"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400">
                Min Risk/Reward Ratio
              </label>
              <input
                type="number"
                value={minRiskReward}
                onChange={(e) => setMinRiskReward(e.target.value)}
                className="input mt-1 w-full"
                step="0.5"
                min="1"
                max="10"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400">
                Max Correlation Exposure (%)
              </label>
              <input
                type="number"
                value={maxCorrelation}
                onChange={(e) => setMaxCorrelation(e.target.value)}
                className="input mt-1 w-full"
                step="5"
                min="10"
                max="100"
              />
            </div>
          </div>
          <div className="mt-4">
            <button className="btn-primary flex items-center gap-2">
              <Save className="h-4 w-4" />
              Save Risk Limits
            </button>
          </div>
        </div>

        {/* API Keys */}
        <div className="card lg:col-span-2">
          <div className="card-header">API Key Management</div>
          <div className="space-y-4">
            {/* Coinbase */}
            <div className="flex items-center justify-between rounded-lg border border-slate-700/30 bg-slate-900/30 p-3">
              <div>
                <div className="text-sm font-medium text-slate-200">
                  Coinbase Advanced
                </div>
                <div className="mt-0.5 font-mono text-xs text-slate-400">
                  {showCoinbaseKey
                    ? coinbaseKey
                    : coinbaseKey.slice(0, 8) + '...'}
                </div>
              </div>
              <button
                onClick={() => setShowCoinbaseKey(!showCoinbaseKey)}
                className="btn-ghost p-2"
              >
                {showCoinbaseKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>

            {/* Alpaca */}
            <div className="flex items-center justify-between rounded-lg border border-slate-700/30 bg-slate-900/30 p-3">
              <div>
                <div className="text-sm font-medium text-slate-200">Alpaca</div>
                <div className="mt-0.5 font-mono text-xs text-slate-400">
                  {showAlpacaKey ? alpacaKey : alpacaKey.slice(0, 6) + '...'}
                </div>
              </div>
              <button
                onClick={() => setShowAlpacaKey(!showAlpacaKey)}
                className="btn-ghost p-2"
              >
                {showAlpacaKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>

            {/* Polymarket */}
            <div className="flex items-center justify-between rounded-lg border border-slate-700/30 bg-slate-900/30 p-3">
              <div>
                <div className="text-sm font-medium text-slate-200">
                  Polymarket
                </div>
                <div className="mt-0.5 font-mono text-xs text-slate-400">
                  {showPolymarketKey
                    ? polymarketKey
                    : polymarketKey.slice(0, 8) + '...'}
                </div>
              </div>
              <button
                onClick={() => setShowPolymarketKey(!showPolymarketKey)}
                className="btn-ghost p-2"
              >
                {showPolymarketKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Notifications */}
        <div className="card lg:col-span-2">
          <div className="card-header">Notification Preferences</div>
          <div className="space-y-3">
            {[
              {
                label: 'Trade Executed',
                desc: 'Get notified when a trade is executed',
                checked: notifyOnTrade,
                onChange: setNotifyOnTrade,
              },
              {
                label: 'Circuit Breaker',
                desc: 'Alert when circuit breaker is triggered',
                checked: notifyOnCircuitBreaker,
                onChange: setNotifyOnCircuitBreaker,
              },
              {
                label: 'Errors',
                desc: 'Notify on agent or engine errors',
                checked: notifyOnError,
                onChange: setNotifyOnError,
              },
              {
                label: 'Daily Report',
                desc: 'Receive daily P&L summary',
                checked: notifyOnDailyReport,
                onChange: setNotifyOnDailyReport,
              },
            ].map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between rounded-lg border border-slate-700/30 bg-slate-900/30 p-3"
              >
                <div>
                  <div className="text-sm font-medium text-slate-200">
                    {item.label}
                  </div>
                  <div className="text-xs text-slate-500">{item.desc}</div>
                </div>
                <button
                  onClick={() => item.onChange(!item.checked)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    item.checked ? 'bg-blue-600' : 'bg-slate-700'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      item.checked ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
