import { useState, useEffect } from 'react';
import { Save, Loader2, CheckCircle } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { RiskLimits } from '@/types/settings';

export function RiskLimitsTab() {
  const queryClient = useQueryClient();
  const [riskSaved, setRiskSaved] = useState(false);

  const [riskPerTrade, setRiskPerTrade] = useState('1.0');
  const [dailyLossCap, setDailyLossCap] = useState('3.0');
  const [weeklyLossCap, setWeeklyLossCap] = useState('7.0');
  const [maxPortfolioHeat, setMaxPortfolioHeat] = useState('6.0');
  const [minRiskReward, setMinRiskReward] = useState('3.0');
  const [maxCorrelation, setMaxCorrelation] = useState('40');

  const { data: riskData } = useQuery<{ data: RiskLimits }>({
    queryKey: ['risk-limits'],
    queryFn: () => apiClient.get<{ data: RiskLimits }>('/settings/risk-limits'),
  });

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

  const saveRiskMutation = useMutation({
    mutationFn: (data: Record<string, number>) =>
      apiClient.put('/settings/risk-limits', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['risk-limits'] });
      setRiskSaved(true);
      setTimeout(() => setRiskSaved(false), 2000);
    },
  });

  const handleSave = () => {
    saveRiskMutation.mutate({
      maxRiskPerTrade: parseFloat(riskPerTrade),
      dailyLossCap: parseFloat(dailyLossCap),
      weeklyLossCap: parseFloat(weeklyLossCap),
      maxPortfolioHeat: parseFloat(maxPortfolioHeat),
      minRiskReward: parseFloat(minRiskReward),
      maxCorrelation: parseFloat(maxCorrelation),
    });
  };

  const fields = [
    { label: 'Max Risk per Trade (%)', value: riskPerTrade, onChange: setRiskPerTrade, step: '0.1', min: '0.1', max: '5' },
    { label: 'Daily Loss Cap (%)', value: dailyLossCap, onChange: setDailyLossCap, step: '0.5', min: '1', max: '10' },
    { label: 'Weekly Loss Cap (%)', value: weeklyLossCap, onChange: setWeeklyLossCap, step: '0.5', min: '2', max: '20' },
    { label: 'Max Portfolio Heat (%)', value: maxPortfolioHeat, onChange: setMaxPortfolioHeat, step: '0.5', min: '1', max: '15' },
    { label: 'Min Risk/Reward Ratio', value: minRiskReward, onChange: setMinRiskReward, step: '0.5', min: '1', max: '10' },
    { label: 'Max Correlation Exposure (%)', value: maxCorrelation, onChange: setMaxCorrelation, step: '5', min: '10', max: '100' },
  ];

  return (
    <div className="card lg:col-span-2">
      <div className="card-header">Risk Limits</div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((field) => (
          <div key={field.label}>
            <label className="text-xs font-medium text-slate-400">{field.label}</label>
            <input
              type="number"
              value={field.value}
              onChange={(e) => field.onChange(e.target.value)}
              className="input mt-1 w-full"
              step={field.step}
              min={field.min}
              max={field.max}
            />
          </div>
        ))}
      </div>
      <div className="mt-4">
        <button
          onClick={handleSave}
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
  );
}
