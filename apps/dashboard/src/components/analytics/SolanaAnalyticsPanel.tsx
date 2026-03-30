import { useQuery } from '@tanstack/react-query';
import { Zap, TrendingUp, TrendingDown, Target, AlertTriangle } from 'lucide-react';
import { apiClient } from '@/lib/api-client';

interface TemplateStats {
  totalTrades: number;
  wins: number;
  losses: number;
  totalPnlSol: number;
  createdAt: string;
}

interface SniperTemplate {
  id: string;
  name: string;
  enabled: boolean;
  stats: TemplateStats;
  buyAmountSol: number;
}

interface TemplatesResponse {
  data: SniperTemplate[];
}

interface SolPriceResponse {
  data: { solBalance: number; solValueUsd: number };
}

function StatPill({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col items-center rounded-lg bg-slate-700/40 px-3 py-2">
      <span className={`text-base font-bold ${color}`}>{value}</span>
      <span className="text-[10px] text-slate-500">{label}</span>
    </div>
  );
}

export function SolanaAnalyticsPanel() {
  const { data: templatesData } = useQuery<TemplatesResponse>({
    queryKey: ['sniper-templates-analytics'],
    queryFn: () => apiClient.get<TemplatesResponse>('/solana/sniper/templates'),
    refetchInterval: 60_000,
  });

  const { data: balanceData } = useQuery<SolPriceResponse>({
    queryKey: ['sol-price-analytics'],
    queryFn: () => apiClient.get<SolPriceResponse>('/solana/balances'),
    staleTime: 60_000,
  });

  const templates = templatesData?.data ?? [];
  const solPriceUsd = balanceData?.data
    ? balanceData.data.solValueUsd / (balanceData.data.solBalance || 1)
    : 130;

  const combined = templates.reduce(
    (acc, t) => ({
      totalTrades: acc.totalTrades + t.stats.totalTrades,
      wins: acc.wins + t.stats.wins,
      losses: acc.losses + t.stats.losses,
      totalPnlSol: acc.totalPnlSol + t.stats.totalPnlSol,
    }),
    { totalTrades: 0, wins: 0, losses: 0, totalPnlSol: 0 }
  );

  const winRate = combined.totalTrades > 0
    ? ((combined.wins / combined.totalTrades) * 100).toFixed(1)
    : '0.0';
  const totalPnlUsd = combined.totalPnlSol * solPriceUsd;
  const isPositive = combined.totalPnlSol >= 0;

  if (templates.length === 0) return null;

  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
      <div className="mb-4 flex items-center gap-2">
        <Zap className="h-4 w-4 text-purple-400" />
        <h3 className="text-sm font-semibold text-slate-200">Solana Sniper Analytics</h3>
      </div>

      {/* Combined stats */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatPill
          label="Total Snipes"
          value={String(combined.totalTrades)}
          color="text-slate-100"
        />
        <StatPill
          label="Win Rate"
          value={`${winRate}%`}
          color={parseFloat(winRate) >= 50 ? 'text-green-400' : 'text-red-400'}
        />
        <StatPill
          label="Total P&L (SOL)"
          value={`${isPositive ? '+' : ''}${combined.totalPnlSol.toFixed(4)}`}
          color={isPositive ? 'text-green-400' : 'text-red-400'}
        />
        <StatPill
          label="P&L (USD)"
          value={`${isPositive ? '+' : ''}$${totalPnlUsd.toFixed(2)}`}
          color={isPositive ? 'text-green-400' : 'text-red-400'}
        />
      </div>

      {/* Per-template breakdown */}
      <div className="space-y-2">
        {templates.map((t) => {
          const tWinRate = t.stats.totalTrades > 0
            ? ((t.stats.wins / t.stats.totalTrades) * 100).toFixed(0)
            : '0';
          const tPnlUsd = t.stats.totalPnlSol * solPriceUsd;
          const tIsPos = t.stats.totalPnlSol >= 0;
          return (
            <div
              key={t.id}
              className="flex items-center justify-between rounded-lg bg-slate-700/30 px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${t.enabled ? 'bg-green-400 animate-pulse' : 'bg-slate-600'}`} />
                <span className="text-xs font-medium text-slate-200">{t.name}</span>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <span className="text-slate-400">
                  <Target className="mr-0.5 inline h-3 w-3" />
                  {t.stats.totalTrades} trades
                </span>
                <span className={t.stats.wins >= t.stats.losses ? 'text-green-400' : 'text-red-400'}>
                  {t.stats.wins}W / {t.stats.losses}L ({tWinRate}%)
                </span>
                <span className={`font-mono ${tIsPos ? 'text-green-400' : 'text-red-400'}`}>
                  {tIsPos
                    ? <TrendingUp className="mr-0.5 inline h-3 w-3" />
                    : <TrendingDown className="mr-0.5 inline h-3 w-3" />}
                  {tIsPos ? '+' : ''}${tPnlUsd.toFixed(2)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {combined.totalTrades === 0 && (
        <div className="mt-2 flex items-center gap-2 rounded-lg bg-slate-700/30 px-3 py-2 text-xs text-slate-500">
          <AlertTriangle className="h-3.5 w-3.5" />
          No sniper trades recorded yet. Start the bot to see analytics here.
        </div>
      )}
    </div>
  );
}
