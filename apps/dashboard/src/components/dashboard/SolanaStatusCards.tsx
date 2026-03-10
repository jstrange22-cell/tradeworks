import {
  DollarSign,
  Crosshair,
  Eye,
  Activity,
} from 'lucide-react';

interface SolBalanceCardProps {
  solBalance: { sol: number; usd: number } | undefined;
}

export function SolBalanceCard({ solBalance }: SolBalanceCardProps) {
  return (
    <div className="card">
      <div className="card-header flex items-center gap-2 text-xs">
        <DollarSign className="h-3.5 w-3.5 text-purple-400" />
        SOL Balance
      </div>
      <div className="text-lg font-bold text-slate-100">
        {solBalance ? `${solBalance.sol.toFixed(3)}` : '--'}
      </div>
      <div className="text-xs text-slate-500">
        {solBalance ? `\u2248 $${solBalance.usd.toFixed(2)}` : 'Loading...'}
      </div>
    </div>
  );
}

interface SniperCardProps {
  sniperStatus: { running: boolean; totalSnipes: number; successfulSnipes: number; openPositions: number } | undefined;
}

export function SniperCard({ sniperStatus }: SniperCardProps) {
  return (
    <div className="card">
      <div className="card-header flex items-center gap-2 text-xs">
        <Crosshair className="h-3.5 w-3.5 text-amber-400" />
        Sniper Engine
      </div>
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${sniperStatus?.running ? 'bg-green-400 animate-pulse' : 'bg-slate-600'}`} />
        <span className="text-sm font-medium text-slate-200">
          {sniperStatus?.running ? 'Active' : 'Stopped'}
        </span>
      </div>
      <div className="text-xs text-slate-500">
        {sniperStatus ? `${sniperStatus.successfulSnipes}/${sniperStatus.totalSnipes} snipes \u00b7 ${sniperStatus.openPositions} open` : '--'}
      </div>
    </div>
  );
}

interface WhaleCardProps {
  whaleMonitor: { running: boolean; trackedWhales: number; totalActivities: number } | undefined;
}

export function WhaleCard({ whaleMonitor }: WhaleCardProps) {
  return (
    <div className="card">
      <div className="card-header flex items-center gap-2 text-xs">
        <Eye className="h-3.5 w-3.5 text-cyan-400" />
        Whale Tracker
      </div>
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${whaleMonitor?.running ? 'bg-green-400 animate-pulse' : 'bg-slate-600'}`} />
        <span className="text-sm font-medium text-slate-200">
          {whaleMonitor?.running ? 'Monitoring' : 'Stopped'}
        </span>
      </div>
      <div className="text-xs text-slate-500">
        {whaleMonitor ? `${whaleMonitor.trackedWhales} whales \u00b7 ${whaleMonitor.totalActivities} txns` : '--'}
      </div>
    </div>
  );
}

interface PumpfunCardProps {
  pumpfunStatus: { running: boolean; totalDetected: number } | undefined;
}

export function PumpfunCard({ pumpfunStatus }: PumpfunCardProps) {
  return (
    <div className="card">
      <div className="card-header flex items-center gap-2 text-xs">
        <Activity className="h-3.5 w-3.5 text-pink-400" />
        pump.fun
      </div>
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${pumpfunStatus?.running ? 'bg-green-400 animate-pulse' : 'bg-slate-600'}`} />
        <span className="text-sm font-medium text-slate-200">
          {pumpfunStatus?.running ? 'Live' : 'Stopped'}
        </span>
      </div>
      <div className="text-xs text-slate-500">
        {pumpfunStatus ? `${pumpfunStatus.totalDetected} launches detected` : '--'}
      </div>
    </div>
  );
}
