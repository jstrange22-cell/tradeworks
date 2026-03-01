import { useState, useEffect } from 'react';
import { Settings, Save, Plus, Trash2, TestTube, Loader2, CheckCircle, XCircle, Key } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { usePortfolioStore } from '@/stores/portfolio-store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MaskedApiKey {
  id: string;
  service: string;
  keyName: string;
  maskedKey: string;
  environment: string;
  createdAt: string;
}

interface ApiKeysResponse {
  data: MaskedApiKey[];
  total: number;
}

interface TestResult {
  success: boolean;
  message: string;
}

interface RiskLimits {
  maxRiskPerTrade: number;
  dailyLossCap: number;
  weeklyLossCap: number;
  maxPortfolioHeat: number;
  minRiskReward: number;
  maxCorrelation: number;
}

// ---------------------------------------------------------------------------
// Service display config
// ---------------------------------------------------------------------------

const SERVICE_INFO: Record<string, { label: string; color: string; description: string }> = {
  coinbase: { label: 'Coinbase', color: 'text-blue-400', description: 'Cryptocurrency trading via Coinbase Advanced' },
  alpaca: { label: 'Alpaca', color: 'text-green-400', description: 'Stock & ETF trading via Alpaca' },
  polymarket: { label: 'Polymarket', color: 'text-purple-400', description: 'Prediction market trading via Polymarket CLOB' },
};

// ---------------------------------------------------------------------------
// Add API Key Modal
// ---------------------------------------------------------------------------

function AddKeyModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [service, setService] = useState<'coinbase' | 'alpaca' | 'polymarket'>('coinbase');
  const [keyName, setKeyName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [environment, setEnvironment] = useState<'production' | 'sandbox' | 'testnet'>('sandbox');
  const [error, setError] = useState('');

  const addMutation = useMutation({
    mutationFn: (data: { service: string; keyName: string; apiKey: string; apiSecret?: string; environment: string }) =>
      apiClient.post('/settings/api-keys', data),
    onSuccess: () => {
      onSuccess();
      onClose();
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to add API key');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyName.trim() || !apiKey.trim()) {
      setError('Key name and API key are required');
      return;
    }
    setError('');
    addMutation.mutate({
      service,
      keyName: keyName.trim(),
      apiKey: apiKey.trim(),
      apiSecret: apiSecret.trim() || undefined,
      environment,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-md rounded-xl border border-slate-700/50 bg-slate-800 p-6 shadow-2xl">
        <h3 className="mb-4 text-lg font-semibold text-slate-100">Add Exchange API Key</h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Service */}
          <div>
            <label className="text-xs font-medium text-slate-400">Exchange</label>
            <select
              value={service}
              onChange={(e) => setService(e.target.value as 'coinbase' | 'alpaca' | 'polymarket')}
              className="input mt-1 w-full"
            >
              <option value="coinbase">Coinbase</option>
              <option value="alpaca">Alpaca</option>
              <option value="polymarket">Polymarket</option>
            </select>
          </div>

          {/* Key Name */}
          <div>
            <label className="text-xs font-medium text-slate-400">Key Name</label>
            <input
              type="text"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              placeholder="e.g., My Trading Key"
              className="input mt-1 w-full"
            />
          </div>

          {/* API Key */}
          <div>
            <label className="text-xs font-medium text-slate-400">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste your API key"
              className="input mt-1 w-full font-mono text-sm"
            />
          </div>

          {/* API Secret */}
          <div>
            <label className="text-xs font-medium text-slate-400">
              API Secret <span className="text-slate-600">(optional)</span>
            </label>
            <input
              type="password"
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              placeholder="Paste your API secret"
              className="input mt-1 w-full font-mono text-sm"
            />
          </div>

          {/* Environment */}
          <div>
            <label className="text-xs font-medium text-slate-400">Environment</label>
            <select
              value={environment}
              onChange={(e) => setEnvironment(e.target.value as 'production' | 'sandbox' | 'testnet')}
              className="input mt-1 w-full"
            >
              <option value="sandbox">Sandbox (Paper Trading)</option>
              <option value="testnet">Testnet</option>
              <option value="production">Production (Real Money)</option>
            </select>
          </div>

          {error && (
            <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost flex-1"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={addMutation.isPending}
              className="btn-primary flex flex-1 items-center justify-center gap-2"
            >
              {addMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Key className="h-4 w-4" />
              )}
              Add Key
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// API Key Card
// ---------------------------------------------------------------------------

function ApiKeyCard({ apiKey, onDeleted }: { apiKey: MaskedApiKey; onDeleted: () => void }) {
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const info = SERVICE_INFO[apiKey.service] ?? { label: apiKey.service, color: 'text-slate-400', description: '' };

  const testMutation = useMutation({
    mutationFn: () => apiClient.post<TestResult>(`/settings/api-keys/${apiKey.id}/test`),
    onSuccess: (data) => setTestResult(data),
    onError: () => setTestResult({ success: false, message: 'Connection test failed' }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.delete(`/settings/api-keys/${apiKey.id}`),
    onSuccess: () => onDeleted(),
  });

  const envBadge = {
    production: 'bg-red-500/10 text-red-400',
    sandbox: 'bg-amber-500/10 text-amber-400',
    testnet: 'bg-blue-500/10 text-blue-400',
  }[apiKey.environment] ?? 'bg-slate-500/10 text-slate-400';

  return (
    <div className="rounded-lg border border-slate-700/30 bg-slate-900/30 p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-semibold ${info.color}`}>{info.label}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${envBadge}`}>
              {apiKey.environment}
            </span>
            {testResult && (
              testResult.success ? (
                <CheckCircle className="h-4 w-4 text-green-400" />
              ) : (
                <XCircle className="h-4 w-4 text-red-400" />
              )
            )}
          </div>
          <div className="mt-1 text-xs text-slate-400">{apiKey.keyName}</div>
          <div className="mt-0.5 font-mono text-xs text-slate-500">{apiKey.maskedKey}</div>
          {testResult && (
            <div className={`mt-2 text-xs ${testResult.success ? 'text-green-400' : 'text-red-400'}`}>
              {testResult.message}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Test button */}
          <button
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
            className="btn-ghost p-2"
            title="Test connection"
          >
            {testMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
            ) : (
              <TestTube className="h-4 w-4 text-blue-400" />
            )}
          </button>

          {/* Delete button */}
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <button
                onClick={() => { deleteMutation.mutate(); setConfirmDelete(false); }}
                className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-500"
              >
                Confirm
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded bg-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-600"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={deleteMutation.isPending}
              className="btn-ghost p-2"
              title="Delete key"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin text-red-400" />
              ) : (
                <Trash2 className="h-4 w-4 text-red-400" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Settings Page
// ---------------------------------------------------------------------------

export function SettingsPage() {
  const { paperTrading, setPaperTrading } = usePortfolioStore();
  const queryClient = useQueryClient();
  const [showAddModal, setShowAddModal] = useState(false);
  const [riskSaved, setRiskSaved] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  // Risk limits form state
  const [riskPerTrade, setRiskPerTrade] = useState('1.0');
  const [dailyLossCap, setDailyLossCap] = useState('3.0');
  const [weeklyLossCap, setWeeklyLossCap] = useState('7.0');
  const [maxPortfolioHeat, setMaxPortfolioHeat] = useState('6.0');
  const [minRiskReward, setMinRiskReward] = useState('3.0');
  const [maxCorrelation, setMaxCorrelation] = useState('40');

  // Engine settings
  const [cycleInterval, setCycleInterval] = useState('600');
  const [notifyOnTrade, setNotifyOnTrade] = useState(true);
  const [notifyOnCircuitBreaker, setNotifyOnCircuitBreaker] = useState(true);
  const [notifyOnError, setNotifyOnError] = useState(true);
  const [notifyOnDailyReport, setNotifyOnDailyReport] = useState(false);

  // Fetch API keys
  const { data: apiKeysData, isLoading: keysLoading } = useQuery<ApiKeysResponse>({
    queryKey: ['api-keys'],
    queryFn: () => apiClient.get<ApiKeysResponse>('/settings/api-keys'),
    refetchInterval: 30000,
  });

  const apiKeys = apiKeysData?.data ?? [];

  // Fetch risk limits from backend
  const { data: riskData } = useQuery<{ data: RiskLimits }>({
    queryKey: ['risk-limits'],
    queryFn: () => apiClient.get<{ data: RiskLimits }>('/settings/risk-limits'),
  });

  // Fetch general settings from backend
  const { data: settingsData } = useQuery<{ data: Record<string, unknown> }>({
    queryKey: ['settings'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>('/settings'),
  });

  // Populate form from fetched risk limits
  useEffect(() => {
    if (riskData?.data) {
      const r = riskData.data;
      if (r.maxRiskPerTrade != null) setRiskPerTrade(String(r.maxRiskPerTrade));
      if (r.dailyLossCap != null) setDailyLossCap(String(r.dailyLossCap));
      if (r.weeklyLossCap != null) setWeeklyLossCap(String(r.weeklyLossCap));
      if (r.maxPortfolioHeat != null) setMaxPortfolioHeat(String(r.maxPortfolioHeat));
      if (r.minRiskReward != null) setMinRiskReward(String(r.minRiskReward));
      if (r.maxCorrelation != null) setMaxCorrelation(String(r.maxCorrelation));
    }
  }, [riskData]);

  // Populate general settings
  useEffect(() => {
    if (settingsData?.data) {
      const s = settingsData.data;
      const cycleVal = s.cycleInterval as { seconds?: number } | undefined;
      if (cycleVal?.seconds != null) setCycleInterval(String(cycleVal.seconds));
      const notif = s.notifications as { onTrade?: boolean; onCircuitBreaker?: boolean; onError?: boolean; onDailyReport?: boolean } | undefined;
      if (notif) {
        if (notif.onTrade != null) setNotifyOnTrade(notif.onTrade);
        if (notif.onCircuitBreaker != null) setNotifyOnCircuitBreaker(notif.onCircuitBreaker);
        if (notif.onError != null) setNotifyOnError(notif.onError);
        if (notif.onDailyReport != null) setNotifyOnDailyReport(notif.onDailyReport);
      }
      const paper = s.paperTrading as { enabled?: boolean } | undefined;
      if (paper?.enabled != null) setPaperTrading(paper.enabled);
    }
  }, [settingsData, setPaperTrading]);

  // Save risk limits mutation
  const saveRiskMutation = useMutation({
    mutationFn: (data: Record<string, number>) =>
      apiClient.put('/settings/risk-limits', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['risk-limits'] });
      setRiskSaved(true);
      setTimeout(() => setRiskSaved(false), 2000);
    },
  });

  // Save general settings mutation
  const saveSettingsMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiClient.put('/settings', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 2000);
    },
  });

  const invalidateKeys = () => {
    queryClient.invalidateQueries({ queryKey: ['api-keys'] });
  };

  const handleSaveRiskLimits = () => {
    saveRiskMutation.mutate({
      maxRiskPerTrade: parseFloat(riskPerTrade),
      dailyLossCap: parseFloat(dailyLossCap),
      weeklyLossCap: parseFloat(weeklyLossCap),
      maxPortfolioHeat: parseFloat(maxPortfolioHeat),
      minRiskReward: parseFloat(minRiskReward),
      maxCorrelation: parseFloat(maxCorrelation),
    });
  };

  const handleTogglePaperTrading = () => {
    const next = !paperTrading;
    setPaperTrading(next);
    saveSettingsMutation.mutate({ paperTrading: next });
  };

  const handleSaveCycleInterval = () => {
    saveSettingsMutation.mutate({ cycleIntervalSeconds: parseInt(cycleInterval, 10) });
  };

  const handleSaveNotifications = () => {
    saveSettingsMutation.mutate({
      notifications: {
        onTrade: notifyOnTrade,
        onCircuitBreaker: notifyOnCircuitBreaker,
        onError: notifyOnError,
        onDailyReport: notifyOnDailyReport,
      },
    });
  };

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
              onClick={handleTogglePaperTrading}
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
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-slate-500">
              Current: every {Math.floor(Number(cycleInterval) / 60)} minutes
            </span>
            <button
              onClick={handleSaveCycleInterval}
              disabled={saveSettingsMutation.isPending}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              {saveSettingsMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : settingsSaved ? (
                <CheckCircle className="h-3.5 w-3.5" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save
            </button>
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
            <button
              onClick={handleSaveRiskLimits}
              disabled={saveRiskMutation.isPending}
              className="btn-primary flex items-center gap-2"
            >
              {saveRiskMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : riskSaved ? (
                <CheckCircle className="h-4 w-4" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {riskSaved ? 'Saved!' : 'Save Risk Limits'}
            </button>
          </div>
        </div>

        {/* API Keys - REAL DATA */}
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between">
            <div className="card-header">API Key Management</div>
            <button
              onClick={() => setShowAddModal(true)}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              <Plus className="h-4 w-4" />
              Add API Key
            </button>
          </div>

          {keysLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
              <span className="ml-2 text-sm text-slate-400">Loading keys...</span>
            </div>
          ) : apiKeys.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/20 py-8 text-center">
              <Key className="mx-auto h-8 w-8 text-slate-600" />
              <p className="mt-2 text-sm text-slate-400">No API keys configured</p>
              <p className="mt-1 text-xs text-slate-500">
                Add your exchange API keys to start trading
              </p>
              <button
                onClick={() => setShowAddModal(true)}
                className="btn-primary mt-4 text-sm"
              >
                <Plus className="mr-1 inline h-4 w-4" />
                Add Your First Key
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {apiKeys.map((key) => (
                <ApiKeyCard key={key.id} apiKey={key} onDeleted={invalidateKeys} />
              ))}
            </div>
          )}
        </div>

        {/* Notifications */}
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between">
            <div className="card-header">Notification Preferences</div>
            <button
              onClick={handleSaveNotifications}
              disabled={saveSettingsMutation.isPending}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              {saveSettingsMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save
            </button>
          </div>
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

      {/* Add Key Modal */}
      {showAddModal && (
        <AddKeyModal
          onClose={() => setShowAddModal(false)}
          onSuccess={invalidateKeys}
        />
      )}
    </div>
  );
}
