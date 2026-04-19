import { useState } from 'react';
import { Eye, Play, Square, Plus } from 'lucide-react';
import {
  useWhaleList, useWhaleActivity, useWhaleMonitorStatus,
  useWhaleAdd, useWhaleMonitorToggle, useWhaleUpdateCopyConfig,
} from '@/hooks/useSolana';
import { DiscoverTraders } from '@/components/solana/DiscoverTraders';
import { TrackedWalletCard } from '@/components/solana/TrackedWalletCard';
import { WhaleActivityFeed } from '@/components/solana/WhaleActivityFeed';

export function WhaleTab() {
  const [newAddr, setNewAddr] = useState('');
  const [newLabel, setNewLabel] = useState('');

  const whaleList = useWhaleList(true);
  const whaleActivity = useWhaleActivity(true);
  const monitorStatus = useWhaleMonitorStatus(true);
  const whaleAdd = useWhaleAdd();
  const monitorToggle = useWhaleMonitorToggle();
  const updateCopy = useWhaleUpdateCopyConfig();

  const running = monitorStatus.data?.running ?? false;
  const trackedCount = monitorStatus.data?.trackedWhales ?? 0;
  const whales = whaleList.data?.data ?? [];
  const activity = whaleActivity.data?.data ?? [];

  const handleAdd = () => {
    if (!newAddr.trim()) return;
    whaleAdd.mutate({ address: newAddr.trim(), label: newLabel.trim() || 'Whale' });
    setNewAddr('');
    setNewLabel('');
  };

  const handleRemove = (address: string) => {
    updateCopy.mutate({ address, enabled: false });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Eye className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-slate-200">Whale Copy Trading</h2>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              running
                ? 'bg-green-500/20 text-green-400'
                : 'bg-slate-700 text-slate-500'
            }`}
          >
            {running ? `TRACKING ${trackedCount}` : 'STOPPED'}
          </span>
        </div>
        <button
          onClick={() => monitorToggle.mutate(running)}
          disabled={monitorToggle.isPending}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
            running
              ? 'bg-red-600 text-white hover:bg-red-500'
              : 'bg-green-600 text-white hover:bg-green-500'
          }`}
        >
          {running ? (
            <><Square className="h-3 w-3" /> Stop</>
          ) : (
            <><Play className="h-3 w-3" /> Start Tracking</>
          )}
        </button>
      </div>

      {/* Discover Traders */}
      <DiscoverTraders />

      {/* Add Custom Wallet */}
      <div className="flex items-center gap-2 rounded-xl border border-slate-700/50 bg-slate-800/50 p-3">
        <Plus className="h-4 w-4 shrink-0 text-slate-400" />
        <input
          type="text"
          placeholder="Solana address"
          value={newAddr}
          onChange={(event) => setNewAddr(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && handleAdd()}
          className="input flex-1 text-xs font-mono"
        />
        <input
          type="text"
          placeholder="Label"
          value={newLabel}
          onChange={(event) => setNewLabel(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && handleAdd()}
          className="input w-28 text-xs"
        />
        <button
          onClick={handleAdd}
          disabled={whaleAdd.isPending || !newAddr.trim()}
          className="shrink-0 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-cyan-500 disabled:opacity-50"
        >
          Add
        </button>
      </div>

      {/* Tracked Wallets */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-200">
          Tracked Wallets
          <span className="ml-2 text-[10px] font-normal text-slate-500">
            {whales.length} wallet{whales.length !== 1 ? 's' : ''}
          </span>
        </h3>
        {whales.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {whales.map((whale) => (
              <TrackedWalletCard
                key={whale.address}
                whale={whale}
                onRemove={handleRemove}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 py-8 text-center text-xs text-slate-500">
            No wallets tracked yet -- add one above or copy from Explore Traders
          </div>
        )}
      </div>

      {/* Activity Feed */}
      <WhaleActivityFeed activity={activity} />
    </div>
  );
}
