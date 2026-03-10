import { useState, useEffect } from 'react';
import { Shield, ShieldOff, DollarSign, Save, Loader2, CheckCircle } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { AssetProtectionConfig, ProtectedAsset } from '@/types/settings';
import { ProtectedAssetsList } from '@/components/settings/ProtectedAssetsList';

export function AssetProtectionTab() {
  const queryClient = useQueryClient();

  const { data: protectionData, isLoading } = useQuery<{ data: AssetProtectionConfig }>({
    queryKey: ['asset-protection'],
    queryFn: () => apiClient.get<{ data: AssetProtectionConfig }>('/settings/asset-protection'),
    refetchInterval: 10000,
  });

  const config = protectionData?.data;
  const [budgetInput, setBudgetInput] = useState('');
  const [budgetSaved, setBudgetSaved] = useState(false);

  useEffect(() => {
    if (config && budgetInput === '') setBudgetInput(String(config.tradingBudgetUsd));
  }, [config, budgetInput]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['asset-protection'] });

  const updateMutation = useMutation({
    mutationFn: (data: Partial<AssetProtectionConfig>) => apiClient.put('/settings/asset-protection', data),
    onSuccess: invalidate,
  });

  const snapshotMutation = useMutation({
    mutationFn: () => apiClient.post('/settings/asset-protection/snapshot'),
    onSuccess: invalidate,
  });

  const toggleMasterSwitch = () => {
    if (config) updateMutation.mutate({ engineTradingEnabled: !config.engineTradingEnabled });
  };

  const toggleAssetLock = (symbol: string, currentlyLocked: boolean) => {
    updateMutation.mutate({
      protectedAssets: { [symbol]: { locked: !currentlyLocked } } as unknown as Record<string, ProtectedAsset>,
    });
  };

  const lockAll = () => {
    if (!config) return;
    const updates: Record<string, ProtectedAsset> = {};
    for (const [sym, asset] of Object.entries(config.protectedAssets)) updates[sym] = { ...asset, locked: true };
    updateMutation.mutate({ protectedAssets: updates });
  };

  const saveBudget = () => {
    const val = parseFloat(budgetInput);
    if (isNaN(val) || val < 0) return;
    updateMutation.mutate({ tradingBudgetUsd: val });
    setBudgetSaved(true);
    setTimeout(() => setBudgetSaved(false), 2000);
  };

  const assets = config ? Object.values(config.protectedAssets) : [];
  const totalProtectedValue = assets.reduce((s, a) => s + a.snapshotValueUsd, 0);
  const lockedCount = assets.filter(a => a.locked).length;

  return (
    <div className="card lg:col-span-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-amber-400" />
          <div className="card-header">Asset Protection</div>
        </div>
        {config && (
          <div className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
            config.engineTradingEnabled ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
          }`}>
            {config.engineTradingEnabled ? <ShieldOff className="h-3.5 w-3.5" /> : <Shield className="h-3.5 w-3.5" />}
            {config.engineTradingEnabled ? 'Live Trading ON' : 'Live Trading OFF'}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-amber-400" />
        </div>
      ) : !config ? (
        <div className="py-4 text-center text-sm text-slate-500">Failed to load protection config</div>
      ) : (
        <div className="space-y-4">
          {/* Master Switch */}
          <div className="flex items-center justify-between rounded-lg border border-slate-700/30 bg-slate-900/30 p-4">
            <div>
              <div className="text-sm font-medium text-slate-200">Engine Live Trading</div>
              <div className="mt-1 text-xs text-slate-500">Master switch. When OFF, the engine cannot place any real trades.</div>
            </div>
            <button onClick={toggleMasterSwitch} disabled={updateMutation.isPending}
              className={`relative inline-flex h-8 w-16 items-center rounded-full transition-colors ${
                config.engineTradingEnabled ? 'bg-green-600' : 'bg-slate-700'
              }`}>
              <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                config.engineTradingEnabled ? 'translate-x-8' : 'translate-x-1.5'
              }`} />
            </button>
          </div>

          {/* Trading Budget */}
          <div className="rounded-lg border border-slate-700/30 bg-slate-900/30 p-4">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-green-400" />
              <div className="text-sm font-medium text-slate-200">Trading Budget</div>
            </div>
            <div className="mt-1 text-xs text-slate-500">Max USD the engine can spend on new positions. Used: ${config.budgetUsedUsd.toFixed(2)}</div>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-sm text-slate-400">$</span>
              <input type="number" value={budgetInput} onChange={(e) => setBudgetInput(e.target.value)}
                className="input w-32" min="0" step="50" />
              <button onClick={saveBudget} disabled={updateMutation.isPending}
                className="btn-primary flex items-center gap-1.5 text-sm">
                {budgetSaved ? <CheckCircle className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
                {budgetSaved ? 'Saved' : 'Save'}
              </button>
            </div>
            {config.tradingBudgetUsd > 0 && (
              <div className="mt-2 h-2 w-full rounded-full bg-slate-700">
                <div className="h-2 rounded-full bg-green-500 transition-all"
                  style={{ width: `${Math.min((config.budgetUsedUsd / config.tradingBudgetUsd) * 100, 100)}%` }} />
              </div>
            )}
          </div>

          <ProtectedAssetsList
            assets={assets}
            lockedCount={lockedCount}
            totalProtectedValue={totalProtectedValue}
            snapshotTakenAt={config.snapshotTakenAt}
            isPending={updateMutation.isPending}
            isSnapshotPending={snapshotMutation.isPending}
            onToggleAssetLock={toggleAssetLock}
            onLockAll={lockAll}
            onTakeSnapshot={() => snapshotMutation.mutate()}
          />
        </div>
      )}
    </div>
  );
}
