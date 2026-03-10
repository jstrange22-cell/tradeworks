import { Shield, Lock, Unlock, Camera, Loader2 } from 'lucide-react';
import type { ProtectedAsset } from '@/types/settings';

interface ProtectedAssetsListProps {
  assets: ProtectedAsset[];
  lockedCount: number;
  totalProtectedValue: number;
  snapshotTakenAt: string | null;
  isPending: boolean;
  isSnapshotPending: boolean;
  onToggleAssetLock: (symbol: string, currentlyLocked: boolean) => void;
  onLockAll: () => void;
  onTakeSnapshot: () => void;
}

export function ProtectedAssetsList({
  assets,
  lockedCount,
  totalProtectedValue,
  snapshotTakenAt,
  isPending,
  isSnapshotPending,
  onToggleAssetLock,
  onLockAll,
  onTakeSnapshot,
}: ProtectedAssetsListProps) {
  return (
    <div className="rounded-lg border border-slate-700/30 bg-slate-900/30 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-blue-400" />
            <div className="text-sm font-medium text-slate-200">Holdings Snapshot</div>
          </div>
          {snapshotTakenAt && (
            <div className="mt-1 text-xs text-slate-500">
              Last snapshot: {new Date(snapshotTakenAt).toLocaleString()} {'\u2014'} {lockedCount}/{assets.length} locked, ${totalProtectedValue.toFixed(0)} protected
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onLockAll} disabled={isPending || assets.length === 0}
            className="btn-ghost flex items-center gap-1.5 text-xs">
            <Lock className="h-3.5 w-3.5 text-amber-400" /> Lock All
          </button>
          <button onClick={onTakeSnapshot} disabled={isSnapshotPending}
            className="btn-primary flex items-center gap-1.5 text-sm">
            {isSnapshotPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
            Take Snapshot
          </button>
        </div>
      </div>

      {assets.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-slate-700 bg-slate-900/20 py-6 text-center">
          <Shield className="mx-auto h-8 w-8 text-slate-600" />
          <p className="mt-2 text-sm text-slate-400">No holdings snapshot taken yet</p>
          <p className="mt-1 text-xs text-slate-500">
            Click "Take Snapshot" to lock your current exchange holdings.
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-1.5">
          {assets.map((asset) => (
            <div key={asset.symbol}
              className="flex items-center justify-between rounded-lg border border-slate-700/20 bg-slate-800/30 px-3 py-2">
              <div className="flex items-center gap-3">
                <button onClick={() => onToggleAssetLock(asset.symbol, asset.locked)}
                  disabled={isPending}
                  className={`rounded-full p-1 transition-colors ${
                    asset.locked
                      ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
                      : 'bg-slate-700/50 text-slate-500 hover:bg-slate-700'
                  }`}
                  title={asset.locked ? 'Protected \u2014 click to unlock' : 'Unlocked \u2014 click to lock'}>
                  {asset.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                </button>
                <div>
                  <span className="text-sm font-semibold text-slate-200">{asset.symbol}</span>
                  <span className="ml-2 text-xs text-slate-500">{asset.snapshotQuantity} units</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-medium text-slate-300">
                  ${asset.snapshotValueUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className={`text-[10px] font-semibold ${asset.locked ? 'text-amber-400' : 'text-slate-500'}`}>
                  {asset.locked ? 'PROTECTED' : 'UNLOCKED'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
