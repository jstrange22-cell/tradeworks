import { useState, useEffect } from 'react';
import { CheckCircle, ShieldOff } from 'lucide-react';

// ─── Helpers ────────────────────────────────────────────────────────────

export function formatCompact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(2);
}

// ─── StatCard ───────────────────────────────────────────────────────────

export function StatCard({ label, value, sub, icon }: {
  label: string; value: string; sub: string; icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-slate-400">{label}</span>{icon}
      </div>
      <div className="text-lg font-bold text-slate-100">{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

// ─── SafetyCheck ────────────────────────────────────────────────────────

export function SafetyCheck({ label, passed, passText, failText }: {
  label: string; passed: boolean; passText: string; failText: string;
}) {
  return (
    <div className={`flex items-center gap-2 rounded-lg border p-2 ${
      passed ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'
    }`}>
      {passed
        ? <CheckCircle className="h-4 w-4 text-green-400" />
        : <ShieldOff className="h-4 w-4 text-red-400" />}
      <div>
        <div className="text-[10px] text-slate-400">{label}</div>
        <div className={`text-xs font-medium ${passed ? 'text-green-400' : 'text-red-400'}`}>
          {passed ? passText : failText}
        </div>
      </div>
    </div>
  );
}

// ─── ConfigInput ────────────────────────────────────────────────────────

export function ConfigInput({ label, value, onChange }: {
  label: string; value: unknown; onChange: (v: string) => void;
}) {
  const [local, setLocal] = useState(String(value ?? ''));
  useEffect(() => { setLocal(String(value ?? '')); }, [value]);
  return (
    <div>
      <label className="text-[10px] text-slate-400">{label}</label>
      <input
        type="text"
        value={local}
        onChange={(event) => setLocal(event.target.value)}
        onBlur={() => { if (local !== String(value ?? '')) onChange(local); }}
        onKeyDown={(event) => { if (event.key === 'Enter') onChange(local); }}
        className="input mt-0.5 w-full text-xs font-mono"
      />
    </div>
  );
}
