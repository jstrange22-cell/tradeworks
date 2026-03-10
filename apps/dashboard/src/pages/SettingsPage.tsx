import { useState, useEffect } from 'react';
import { Settings, Save, Loader2, CheckCircle } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { usePortfolioStore } from '@/stores/portfolio-store';
import { ApiKeysTab } from '@/components/settings/ApiKeysTab';
import { RiskLimitsTab } from '@/components/settings/RiskLimitsTab';
import { AssetProtectionTab } from '@/components/settings/AssetProtectionTab';
import { NotificationsSection } from '@/components/settings/NotificationsSection';

export function SettingsPage() {
  const { paperTrading, setPaperTrading } = usePortfolioStore();
  const queryClient = useQueryClient();
  const [settingsSaved, setSettingsSaved] = useState(false);

  const [cycleInterval, setCycleInterval] = useState('600');
  const [notifs, setNotifs] = useState({ onTrade: true, onCircuitBreaker: true, onError: true, onDailyReport: false });

  const [initialAddService] = useState<string | undefined>(() => {
    const params = new URLSearchParams(window.location.search);
    const addKey = params.get('addKey');
    if (addKey && ['coinbase', 'alpaca', 'polymarket'].includes(addKey)) {
      window.history.replaceState({}, '', window.location.pathname);
      return addKey;
    }
    return undefined;
  });

  const { data: settingsData } = useQuery<{ data: Record<string, unknown> }>({
    queryKey: ['settings'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>('/settings'),
  });

  useEffect(() => {
    if (!settingsData?.data) return;
    const s = settingsData.data;
    const cycleVal = s.cycleInterval as { seconds?: number } | undefined;
    if (cycleVal?.seconds != null) setCycleInterval(String(cycleVal.seconds));
    const n = s.notifications as Record<string, boolean> | undefined;
    if (n) setNotifs((prev) => ({ ...prev, ...n }));
    const paper = s.paperTrading as { enabled?: boolean } | undefined;
    if (paper?.enabled != null) setPaperTrading(paper.enabled);
  }, [settingsData, setPaperTrading]);

  const saveSettingsMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => apiClient.put('/settings', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 2000);
    },
  });

  const handleTogglePaperTrading = () => {
    const next = !paperTrading;
    setPaperTrading(next);
    saveSettingsMutation.mutate({ paperTrading: next });
  };

  const handleSaveCycleInterval = () => {
    saveSettingsMutation.mutate({ cycleIntervalSeconds: parseInt(cycleInterval, 10) });
  };

  const notificationItems = [
    { label: 'Trade Executed', desc: 'Get notified when a trade is executed', checked: notifs.onTrade, onChange: (v: boolean) => setNotifs((p) => ({ ...p, onTrade: v })) },
    { label: 'Circuit Breaker', desc: 'Alert when circuit breaker is triggered', checked: notifs.onCircuitBreaker, onChange: (v: boolean) => setNotifs((p) => ({ ...p, onCircuitBreaker: v })) },
    { label: 'Errors', desc: 'Notify on agent or engine errors', checked: notifs.onError, onChange: (v: boolean) => setNotifs((p) => ({ ...p, onError: v })) },
    { label: 'Daily Report', desc: 'Receive daily P&L summary', checked: notifs.onDailyReport, onChange: (v: boolean) => setNotifs((p) => ({ ...p, onDailyReport: v })) },
  ];

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
              <div className="text-sm font-medium text-slate-200">Paper / Live Toggle</div>
              <div className="mt-1 text-xs text-slate-500">
                Paper mode simulates trades without real money. Switch to Live mode when ready for production.
              </div>
            </div>
            <button onClick={handleTogglePaperTrading}
              className={`relative inline-flex h-8 w-16 items-center rounded-full transition-colors ${
                paperTrading ? 'bg-amber-600' : 'bg-blue-600'
              }`}>
              <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                paperTrading ? 'translate-x-1.5' : 'translate-x-8'
              }`} />
            </button>
          </div>
          <div className={`mt-3 rounded-lg px-3 py-2 text-sm font-medium ${
            paperTrading ? 'bg-amber-500/10 text-amber-400' : 'bg-blue-500/10 text-blue-400'
          }`}>
            Currently: {paperTrading ? 'PAPER TRADING' : 'LIVE TRADING'}
          </div>
        </div>

        {/* Engine Cycle Interval */}
        <div className="card">
          <div className="card-header">Engine Configuration</div>
          <div>
            <label className="text-sm font-medium text-slate-200">Cycle Interval (seconds)</label>
            <p className="mt-0.5 text-xs text-slate-500">How often the engine runs a full analysis + trade cycle.</p>
            <input type="number" value={cycleInterval} onChange={(e) => setCycleInterval(e.target.value)}
              className="input mt-2 w-full" min="60" max="3600" step="60" />
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-slate-500">Current: every {Math.floor(Number(cycleInterval) / 60)} minutes</span>
            <button onClick={handleSaveCycleInterval} disabled={saveSettingsMutation.isPending}
              className="btn-primary flex items-center gap-2 text-sm">
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

        <AssetProtectionTab />
        <RiskLimitsTab />
        <ApiKeysTab initialAddService={initialAddService} />

        <NotificationsSection
          items={notificationItems}
          onSave={() => saveSettingsMutation.mutate({ notifications: notifs })}
          isPending={saveSettingsMutation.isPending}
        />
      </div>
    </div>
  );
}
