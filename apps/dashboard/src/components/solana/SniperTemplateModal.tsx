import { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { ConfigInput } from '@/components/solana/shared';
import type { TemplateStatusItem } from '@/types/solana';

export interface TemplateFormData {
  name: string;
  buyAmountSol: number;
  dailyBudgetSol: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  slippageBps: number;
  priorityFee: number;
  maxMarketCapUsd: number;
  maxOpenPositions: number;
  autoBuyPumpFun: boolean;
  autoBuyTrending: boolean;
  requireMintRevoked: boolean;
  requireFreezeRevoked: boolean;
  paperMode: boolean;
  // Phase 1: Momentum
  momentumWindowMs: number;
  minUniqueBuyers: number;
  minBuySellRatio: number;
  minBuyVolumeSol: number;
  // Phase 2: Filters
  minBondingCurveSol: number;
  maxBondingCurveProgress: number;
  enableSpamFilter: boolean;
  // Phase 3: Circuit Breakers
  consecutiveLossPauseThreshold: number;
  consecutiveLossPauseMs: number;
  maxDailyLossSol: number;
  // Phase 4: RugCheck
  enableRugCheck: boolean;
  minRugCheckScore: number;
  maxTopHolderPct: number;
  rugCheckTimeoutMs: number;
}

const DEFAULTS: TemplateFormData = {
  name: '', buyAmountSol: 0.05, dailyBudgetSol: 1, takeProfitPercent: 100,
  stopLossPercent: -50, slippageBps: 1500, priorityFee: 100000,
  maxMarketCapUsd: 500000, maxOpenPositions: 5, autoBuyPumpFun: false,
  autoBuyTrending: false, requireMintRevoked: true, requireFreezeRevoked: true,
  paperMode: false,
  // Phase 1: Momentum
  momentumWindowMs: 30000, minUniqueBuyers: 3, minBuySellRatio: 2.0, minBuyVolumeSol: 1.0,
  // Phase 2: Filters
  minBondingCurveSol: 0, maxBondingCurveProgress: 0.95, enableSpamFilter: true,
  // Phase 3: Circuit Breakers
  consecutiveLossPauseThreshold: 3, consecutiveLossPauseMs: 300000, maxDailyLossSol: 0.5,
  // Phase 4: RugCheck
  enableRugCheck: false, minRugCheckScore: 500, maxTopHolderPct: 30, rugCheckTimeoutMs: 3000,
};

const NUM_FIELDS: Array<{ key: keyof TemplateFormData; label: string; step?: number }> = [
  { key: 'buyAmountSol', label: 'Buy Amount (SOL)' },
  { key: 'dailyBudgetSol', label: 'Daily Budget (SOL)' },
  { key: 'takeProfitPercent', label: 'Take Profit %' },
  { key: 'stopLossPercent', label: 'Stop Loss %' },
  { key: 'slippageBps', label: 'Slippage (bps)' },
  { key: 'priorityFee', label: 'Priority Fee' },
  { key: 'maxMarketCapUsd', label: 'Max MCap ($)' },
  { key: 'maxOpenPositions', label: 'Max Positions' },
  // Phase 1: Momentum
  { key: 'momentumWindowMs', label: 'Momentum window (ms)', step: 1000 },
  { key: 'minUniqueBuyers', label: 'Min unique buyers', step: 1 },
  { key: 'minBuySellRatio', label: 'Min buy/sell ratio', step: 0.1 },
  { key: 'minBuyVolumeSol', label: 'Min buy volume (SOL)', step: 0.1 },
  // Phase 2: Filters
  { key: 'minBondingCurveSol', label: 'Min bonding curve SOL', step: 0.1 },
  { key: 'maxBondingCurveProgress', label: 'Max bonding curve progress', step: 0.05 },
  // Phase 3: Circuit Breakers
  { key: 'consecutiveLossPauseThreshold', label: 'Loss pause threshold', step: 1 },
  { key: 'consecutiveLossPauseMs', label: 'Loss pause duration (ms)', step: 30000 },
  { key: 'maxDailyLossSol', label: 'Max daily loss (SOL)', step: 0.01 },
  // Phase 4: RugCheck
  { key: 'minRugCheckScore', label: 'Min RugCheck score', step: 50 },
  { key: 'maxTopHolderPct', label: 'Max top holder %', step: 5 },
  { key: 'rugCheckTimeoutMs', label: 'RugCheck timeout (ms)', step: 500 },
];

const BOOL_FIELDS: Array<{ key: keyof TemplateFormData; label: string }> = [
  { key: 'autoBuyPumpFun', label: 'Auto-snipe pump.fun' },
  { key: 'autoBuyTrending', label: 'Auto-snipe trending' },
  { key: 'requireMintRevoked', label: 'Require mint revoked' },
  { key: 'requireFreezeRevoked', label: 'Require freeze revoked' },
  { key: 'paperMode', label: 'Paper mode (simulated)' },
  { key: 'enableSpamFilter', label: 'Spam name filter' },
  { key: 'enableRugCheck', label: 'RugCheck validation' },
];

interface SniperTemplateModalProps {
  editing: TemplateStatusItem | null;
  onSave: (data: TemplateFormData, id?: string) => void;
  onClose: () => void;
  isSaving: boolean;
}

function toFormData(tpl: TemplateStatusItem): TemplateFormData {
  const {
    id: _id, enabled: _e, stats: _s, running: _r, dailySpentSol: _d,
    openPositionCount: _o, minLiquidityUsd: _m, paperBalanceSol: _pb,
    pendingTokens: _pt, circuitBreakerPausedUntil: _cb,
    consecutiveLosses: _cl, dailyRealizedLossSol: _drl,
    ...rest
  } = tpl;
  return {
    ...rest,
    paperMode: rest.paperMode ?? false,
    momentumWindowMs: rest.momentumWindowMs ?? DEFAULTS.momentumWindowMs,
    minUniqueBuyers: rest.minUniqueBuyers ?? DEFAULTS.minUniqueBuyers,
    minBuySellRatio: rest.minBuySellRatio ?? DEFAULTS.minBuySellRatio,
    minBuyVolumeSol: rest.minBuyVolumeSol ?? DEFAULTS.minBuyVolumeSol,
    minBondingCurveSol: rest.minBondingCurveSol ?? DEFAULTS.minBondingCurveSol,
    maxBondingCurveProgress: rest.maxBondingCurveProgress ?? DEFAULTS.maxBondingCurveProgress,
    enableSpamFilter: rest.enableSpamFilter ?? DEFAULTS.enableSpamFilter,
    consecutiveLossPauseThreshold: rest.consecutiveLossPauseThreshold ?? DEFAULTS.consecutiveLossPauseThreshold,
    consecutiveLossPauseMs: rest.consecutiveLossPauseMs ?? DEFAULTS.consecutiveLossPauseMs,
    maxDailyLossSol: rest.maxDailyLossSol ?? DEFAULTS.maxDailyLossSol,
    enableRugCheck: rest.enableRugCheck ?? DEFAULTS.enableRugCheck,
    minRugCheckScore: rest.minRugCheckScore ?? DEFAULTS.minRugCheckScore,
    maxTopHolderPct: rest.maxTopHolderPct ?? DEFAULTS.maxTopHolderPct,
    rugCheckTimeoutMs: rest.rugCheckTimeoutMs ?? DEFAULTS.rugCheckTimeoutMs,
  };
}

export function SniperTemplateModal({ editing, onSave, onClose, isSaving }: SniperTemplateModalProps) {
  const [form, setForm] = useState<TemplateFormData>(DEFAULTS);

  useEffect(() => {
    setForm(editing ? toFormData(editing) : DEFAULTS);
  }, [editing]);

  const handleSubmit = useCallback(() => {
    if (!form.name.trim()) return;
    onSave(form, editing?.id);
  }, [form, editing, onSave]);

  const setNum = useCallback((key: keyof TemplateFormData, raw: string) => {
    setForm((prev) => ({ ...prev, [key]: parseFloat(raw) || 0 }));
  }, []);

  const setBool = useCallback((key: keyof TemplateFormData, checked: boolean) => {
    setForm((prev) => ({ ...prev, [key]: checked }));
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog" aria-modal="true"
      aria-label={editing ? `Edit ${editing.name}` : 'Create Sniper Template'}>
      <div className="w-full max-w-lg rounded-xl border border-slate-700/50 bg-slate-900 p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-100">
            {editing ? 'Edit Template' : 'Create Sniper Template'}
          </h3>
          <button onClick={onClose} aria-label="Close modal"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4">
          <label className="text-[10px] text-slate-400">Template Name</label>
          <input type="text" value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            placeholder="e.g. Aggressive Pump Sniper" className="input mt-0.5 w-full text-xs" />
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3 text-xs lg:grid-cols-4">
          {NUM_FIELDS.map(({ key, label }) => (
            <ConfigInput key={key} label={label} value={form[key] as number}
              onChange={(value) => setNum(key, value)} />
          ))}
        </div>

        <div className="mb-5 grid grid-cols-2 gap-2 text-xs">
          {BOOL_FIELDS.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 text-slate-400 cursor-pointer">
              <input type="checkbox" checked={form[key] as boolean}
                onChange={(event) => setBool(key, event.target.checked)}
                className="rounded bg-slate-700 text-blue-500 focus:ring-blue-500/30" />
              {label}
            </label>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose}
            className="rounded-lg px-4 py-2 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={!form.name.trim() || isSaving}
            className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50">
            {isSaving ? 'Saving...' : editing ? 'Save Changes' : 'Create Template'}
          </button>
        </div>
      </div>
    </div>
  );
}
