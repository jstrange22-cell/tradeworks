import { useState } from 'react';
import { Eye, Play, Square, Plus, Activity, Copy } from 'lucide-react';
import { formatCompact } from '@/components/solana/shared';
import {
  useWhaleList, useWhaleActivity, useWhaleMonitorStatus,
  useWhaleAdd, useWhaleMonitorToggle,
} from '@/hooks/useSolana';

export function WhaleTab() {
  const [newAddr, setNewAddr] = useState('');
  const [newLabel, setNewLabel] = useState('');

  const whaleList = useWhaleList(true);
  const whaleActivity = useWhaleActivity(true);
  const whaleMonitorStatus = useWhaleMonitorStatus(true);
  const whaleAdd = useWhaleAdd();
  const whaleMonitorToggle = useWhaleMonitorToggle();

  const monitorRunning = whaleMonitorStatus.data?.running ?? false;
  const whales = whaleList.data?.data ?? [];
  const activity = whaleActivity.data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Eye className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-slate-200">Whale Tracker</h2>
          <span className={`text-[10px] px-2 py-0.5 rounded-full ${monitorRunning ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-500'}`}>
            {monitorRunning ? 'TRACKING' : 'STOPPED'}
          </span>
        </div>
        <button
          onClick={() => whaleMonitorToggle.mutate(monitorRunning)}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${monitorRunning ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`}
        >
          {monitorRunning ? <><Square className="h-3 w-3" /> Stop</> : <><Play className="h-3 w-3" /> Start Tracking</>}
        </button>
      </div>

      {/* Add Whale */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
          <Plus className="h-4 w-4" /> Add Whale Wallet
        </h3>
        <div className="flex gap-3">
          <input type="text" placeholder="Solana address" value={newAddr} onChange={(event) => setNewAddr(event.target.value)} className="input flex-1 text-xs font-mono" />
          <input type="text" placeholder="Label" value={newLabel} onChange={(event) => setNewLabel(event.target.value)} className="input w-32 text-xs" />
          <button
            onClick={() => {
              if (newAddr) {
                whaleAdd.mutate({ address: newAddr, label: newLabel || 'Whale' });
                setNewAddr('');
                setNewLabel('');
              }
            }}
            className="btn-primary px-4 text-xs"
          >
            Add
          </button>
        </div>
      </div>

      {/* Tracked Whales */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-200">Tracked Wallets ({whales.length})</h3>
        <div className="space-y-1.5">
          {whales.map((whale) => (
            <div key={whale.address} className="flex items-center justify-between rounded-lg border border-slate-700/30 bg-slate-900/20 p-2 text-xs">
              <div>
                <span className="font-medium text-cyan-400">{whale.label}</span>
                <span className="ml-2 font-mono text-slate-500">{whale.address.slice(0, 8)}...{whale.address.slice(-4)}</span>
              </div>
              <div className="text-slate-400">{whale.totalTxns} txns</div>
            </div>
          ))}
          {whales.length === 0 && (
            <div className="text-center text-slate-500 py-4">No whales tracked yet -- add one above</div>
          )}
        </div>
      </div>

      {/* Activity Feed */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
          <Activity className="h-4 w-4" /> Activity Feed
        </h3>
        <div className="space-y-1.5">
          {activity.map((item) => (
            <div
              key={item.id}
              className={`flex items-center justify-between rounded-lg border p-2 text-xs ${
                item.type === 'buy' ? 'border-green-500/20 bg-green-500/5' : 'border-red-500/20 bg-red-500/5'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`font-bold ${item.type === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                  {item.type.toUpperCase()}
                </span>
                <span className="text-slate-200">{item.tokenSymbol}</span>
                <span className="text-slate-500">by {item.whaleLabel}</span>
                {item.copied && <span title="Copy-traded"><Copy className="h-3 w-3 text-cyan-400" /></span>}
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-slate-300">${formatCompact(item.amountUsd)}</span>
                <span className="text-slate-500 text-[10px]">{new Date(item.timestamp).toLocaleTimeString()}</span>
              </div>
            </div>
          ))}
          {activity.length === 0 && (
            <div className="text-center text-slate-500 py-4">No whale activity detected yet</div>
          )}
        </div>
      </div>
    </div>
  );
}
