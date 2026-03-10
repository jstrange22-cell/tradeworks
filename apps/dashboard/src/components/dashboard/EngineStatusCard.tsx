import { Rocket, ExternalLink } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { SolBalanceCard, SniperCard, WhaleCard, PumpfunCard } from './SolanaStatusCards';
import { MoonshotAlertsCard, PumpfunLaunchesCard } from './SolanaAlertCards';

interface EngineStatusCardProps {
  hasSolana: boolean;
}

export function EngineStatusCard({ hasSolana }: EngineStatusCardProps) {
  const { data: solBalanceData } = useQuery<{ data: { sol: number; usd: number; tokens: unknown[] } }>({
    queryKey: ['sol-balance-dash'],
    queryFn: () => apiClient.get('/solana/balances/wallet'),
    enabled: hasSolana,
    refetchInterval: 30_000,
  });

  const { data: sniperStatus } = useQuery<{ running: boolean; totalSnipes: number; successfulSnipes: number; dailySpentSol: number; openPositions: number }>({
    queryKey: ['sniper-status-dash'],
    queryFn: () => apiClient.get('/solana/sniper/status'),
    enabled: hasSolana,
    refetchInterval: 15_000,
  });

  const { data: whaleMonitor } = useQuery<{ running: boolean; trackedWhales: number; totalActivities: number }>({
    queryKey: ['whale-monitor-dash'],
    queryFn: () => apiClient.get('/solana/whales/monitor/status'),
    enabled: hasSolana,
    refetchInterval: 15_000,
  });

  const { data: moonshotAlerts } = useQuery<{ data: Array<{ mint: string; symbol: string; name: string; score: number; recommendation: string; rugRisk: string }> }>({
    queryKey: ['moonshot-alerts-dash'],
    queryFn: () => apiClient.get('/solana/moonshot/alerts'),
    enabled: hasSolana,
    refetchInterval: 30_000,
  });

  const { data: pumpfunStatus } = useQuery<{ running: boolean; totalDetected: number; recentLaunches: Array<{ mint: string; symbol: string; name: string; usdMarketCap: number; bondingCurveProgress: number }> }>({
    queryKey: ['pumpfun-status-dash'],
    queryFn: () => apiClient.get('/solana/pumpfun/monitor/status'),
    enabled: hasSolana,
    refetchInterval: 15_000,
  });

  if (!hasSolana) return null;

  const topAlerts = moonshotAlerts?.data?.slice(0, 3) ?? [];
  const recentPumpLaunches = pumpfunStatus?.recentLaunches?.slice(0, 5) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-100">
          <Rocket className="h-5 w-5 text-purple-400" />
          Solana Meme Trading
        </h2>
        <a
          href="/solana"
          className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
        >
          Full Dashboard <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SolBalanceCard solBalance={solBalanceData?.data} />
        <SniperCard sniperStatus={sniperStatus} />
        <WhaleCard whaleMonitor={whaleMonitor} />
        <PumpfunCard pumpfunStatus={pumpfunStatus} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <MoonshotAlertsCard alerts={topAlerts} />
        <PumpfunLaunchesCard launches={recentPumpLaunches} />
      </div>
    </div>
  );
}
