import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { Zap, TrendingUp, BarChart3, Trophy, RefreshCw, Coins, Rocket } from 'lucide-react';
import { RegimeBanner } from '@/components/command-center/RegimeBanner';
import { MarketCard } from '@/components/command-center/MarketCard';
import { AllocationBar } from '@/components/command-center/AllocationBar';
import { ActionItems } from '@/components/command-center/ActionItems';
import { LiveTradesFeed } from '@/components/command-center/LiveTradesFeed';

// ── Types ────────────────────────────────────────────────────────────────

interface RegimeResponse {
  data: {
    regime: string;
    confidence: number;
    positionSizeMultiplier: number;
    summary: string;
    signals: Array<{ name: string; value: number; interpretation: 'bullish' | 'bearish' | 'neutral' }>;
  };
}

interface AllocationResponse {
  data: {
    regime: { current: string };
    allocation: Array<{
      market: string;
      percent: number;
      usd: number;
      risk: string;
      status: string;
    }>;
    cashReserve: { percent: number; usd: number };
    totalCapital: number;
  };
}

interface BriefingResponse {
  data: {
    actionItems: Array<{
      priority: 'high' | 'medium' | 'low';
      market: string;
      action: string;
      details: string;
    }>;
    agentResults: Array<{
      agent: string;
      status: string;
      findings: number;
      summary: string;
      durationMs: number;
    }>;
    totalOpportunities: number;
  };
}

interface SniperStatusResponse {
  anyRunning: boolean;
  paperBalanceSol?: number;
  openPositions: Array<{ symbol: string; pnlPercent: number }>;
  stats: { totalTrades: number; wins: number; losses: number; totalPnlSol: number; totalPnlUsd: number; totalValueUsd?: number };
  templates: Array<{ name: string; enabled: boolean; stats: { totalTrades: number; wins: number } }>;
}

interface CryptoStatus { data: { running: boolean; paperTrades: number; paperPnlUsd: number; paperCashUsd: number; paperTotalValue: number } }
interface KalshiPaper { data: { trades: number; totalPnlUsd: number; totalValue: number; openPositions: Array<unknown> } }
interface SportsPortfolio { data: { totalBets: number; totalPnlUsd: number; totalValue: number; openBets: Array<unknown> } }
interface StocksPortfolio { data: { totalTrades: number; totalPnlUsd: number; totalValue: number; openPositions: Array<unknown> } }
interface ArbStatus { data: { running: boolean; scanCycles: number; tradesExecuted: number } }

// ── Helpers ──────────────────────────────────────────────────────────────

const allocationColors: Record<string, string> = {
  crypto: 'bg-orange-500',
  stocks: 'bg-blue-500',
  predictions: 'bg-purple-500',
  sports: 'bg-emerald-500',
};

// ── Component ────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { data: regimeData, isLoading: regimeLoading } = useQuery<RegimeResponse>({
    queryKey: ['macro-regime'],
    queryFn: () => apiClient.get('/market/regime'),
    refetchInterval: 300_000,
  });

  const { data: allocationData } = useQuery<AllocationResponse>({
    queryKey: ['allocation-overview'],
    queryFn: () => apiClient.get('/allocation/overview'),
    refetchInterval: 300_000,
  });

  const { data: briefingData, refetch: refetchBriefing, isFetching: briefingFetching } = useQuery<BriefingResponse>({
    queryKey: ['intel-briefing-summary'],
    queryFn: () => apiClient.get('/intel/briefing'),
    refetchInterval: 900_000,
  });

  const { data: sniperData } = useQuery<SniperStatusResponse>({
    queryKey: ['sniper-status-cc'],
    queryFn: () => apiClient.get('/solana/sniper/status'),
    refetchInterval: 30_000,
  });

  // Fetch ALL bot statuses for unified dashboard
  const { data: cryptoData } = useQuery<CryptoStatus>({
    queryKey: ['crypto-status-cc'],
    queryFn: () => apiClient.get('/crypto/status'),
    refetchInterval: 30_000,
  });
  const { data: kalshiData } = useQuery<KalshiPaper>({
    queryKey: ['kalshi-cc'],
    queryFn: () => apiClient.get('/polymarket/kalshi/paper'),
    refetchInterval: 30_000,
  });
  const { data: sportsData } = useQuery<SportsPortfolio>({
    queryKey: ['sports-cc'],
    queryFn: () => apiClient.get('/sports/portfolio'),
    refetchInterval: 30_000,
  });
  const { data: stocksData } = useQuery<StocksPortfolio>({
    queryKey: ['stocks-cc'],
    queryFn: () => apiClient.get('/stocks-intel/portfolio'),
    refetchInterval: 30_000,
  });
  const { data: arbData } = useQuery<ArbStatus>({
    queryKey: ['arb-cc'],
    queryFn: () => apiClient.get('/arb-intel/status'),
    refetchInterval: 30_000,
  });

  const regime = regimeData?.data;
  const allocation = allocationData?.data;
  const briefing = briefingData?.data;
  const sniper = sniperData;

  const crypto = (cryptoData as CryptoStatus | undefined)?.data;
  const kalshi = (kalshiData as KalshiPaper | undefined)?.data;
  const sports = (sportsData as SportsPortfolio | undefined)?.data;
  const stocks = (stocksData as StocksPortfolio | undefined)?.data;
  const arb = (arbData as ArbStatus | undefined)?.data;

  // Solana stats
  const activeStrategies = sniper?.templates?.filter(t => t.enabled).length ?? 0;
  const totalTrades = sniper?.stats?.totalTrades ?? 0;
  const totalWins = sniper?.stats?.wins ?? 0;
  const winRate = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : '0';
  const pnlSol = sniper?.stats?.totalPnlSol ?? 0;
  const openCount = sniper?.openPositions?.length ?? 0;

  // Aggregate P&L and equity across ALL bots using actual portfolio values
  const totalDailyPnl = (sniper?.stats?.totalPnlUsd ?? pnlSol * 130) + (crypto?.paperPnlUsd ?? 0) + (kalshi?.totalPnlUsd ?? 0) + (sports?.totalPnlUsd ?? 0) + (stocks?.totalPnlUsd ?? 0);
  // Sum actual portfolio values from each bot (starting capitals: Solana ~10 SOL, Crypto $1K, Kalshi $1K, Sports $1K, Stocks $10K, CEX $5K)
  const totalEquity =
    (sniper?.stats?.totalValueUsd ?? (sniper?.paperBalanceSol ?? 10) * 130) +
    (crypto?.paperTotalValue ?? 1000) +
    (kalshi?.totalValue ?? 1000) +
    (sports?.totalValue ?? 1000) +
    (stocks?.totalValue ?? 10000);

  // Allocation segments
  const segments = (allocation?.allocation ?? []).map(a => ({
    market: a.market.charAt(0).toUpperCase() + a.market.slice(1),
    percent: a.percent,
    color: allocationColors[a.market] ?? 'bg-slate-500',
  }));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">APEX Command Center</h1>
          <p className="text-sm text-slate-400">Multi-market trading intelligence</p>
        </div>
        <button
          onClick={() => refetchBriefing()}
          disabled={briefingFetching}
          className="flex items-center gap-1.5 rounded-lg bg-slate-700/50 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:bg-slate-700 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${briefingFetching ? 'animate-spin' : ''}`} />
          Scan Markets
        </button>
      </div>

      {/* Macro Regime Banner */}
      {regimeLoading ? (
        <div className="h-24 animate-pulse rounded-xl bg-slate-800/50" />
      ) : regime ? (
        <RegimeBanner
          regime={regime.regime}
          confidence={regime.confidence}
          positionSizeMultiplier={regime.positionSizeMultiplier}
          summary={regime.summary}
          signals={regime.signals}
        />
      ) : null}

      {/* Daily P&L Banner */}
      <div className="flex items-center justify-between rounded-xl border border-slate-700/50 bg-slate-800/50 px-4 py-3">
        <div>
          <span className="text-xs text-slate-500">Total Equity (Paper)</span>
          <div className="text-xl font-bold text-white">${totalEquity.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
        </div>
        <div className="text-right">
          <span className="text-xs text-slate-500">Daily P&L (All Bots)</span>
          <div className={`text-xl font-bold ${totalDailyPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {totalDailyPnl >= 0 ? '+' : ''}${totalDailyPnl.toFixed(2)}
          </div>
        </div>
      </div>

      {/* 6 Market Cards with Live P&L */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MarketCard
          title="Crypto Agent"
          icon={Coins}
          iconColor="bg-blue-500/20 text-blue-400"
          status={crypto?.running ? 'active' : 'not_configured'}
          stats={[
            { label: 'Trades', value: crypto?.paperTrades ?? 0 },
            { label: 'P&L', value: `${(crypto?.paperPnlUsd ?? 0) >= 0 ? '+' : ''}$${(crypto?.paperPnlUsd ?? 0).toFixed(2)}`, color: (crypto?.paperPnlUsd ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400' },
            { label: 'Value', value: `$${(crypto?.paperTotalValue ?? 1000).toFixed(0)}` },
            { label: 'Engine', value: 'Signal+Tradevisor' },
          ]}
          link="/crypto"
          linkLabel="Crypto Trading"
        />

        <MarketCard
          title="Solana Memes"
          icon={Zap}
          iconColor="bg-orange-500/20 text-orange-400"
          status={activeStrategies > 0 ? 'active' : 'not_configured'}
          stats={[
            { label: 'Strategies', value: activeStrategies },
            { label: 'Win Rate', value: `${winRate}%` },
            { label: 'P&L', value: `${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(3)} SOL`, color: pnlSol >= 0 ? 'text-emerald-400' : 'text-red-400' },
            { label: 'Open', value: openCount },
          ]}
          link="/solana"
          linkLabel="Meme Coin Sniper"
        />

        <MarketCard
          title="Stocks & Options"
          icon={BarChart3}
          iconColor="bg-indigo-500/20 text-indigo-400"
          status={(stocks?.totalTrades ?? 0) > 0 ? 'active' : 'not_configured'}
          stats={[
            { label: 'Trades', value: stocks?.totalTrades ?? 0 },
            { label: 'P&L', value: `${(stocks?.totalPnlUsd ?? 0) >= 0 ? '+' : ''}$${(stocks?.totalPnlUsd ?? 0).toFixed(2)}`, color: (stocks?.totalPnlUsd ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400' },
            { label: 'Positions', value: stocks?.openPositions?.length ?? 0 },
            { label: '14 Engines', value: 'Alpaca' },
          ]}
          link="/stocks"
          linkLabel="Stock Intelligence"
        />

        <MarketCard
          title="Kalshi Predictions"
          icon={TrendingUp}
          iconColor="bg-purple-500/20 text-purple-400"
          status="active"
          stats={[
            { label: 'Trades', value: kalshi?.trades ?? 0 },
            { label: 'P&L', value: `${(kalshi?.totalPnlUsd ?? 0) >= 0 ? '+' : ''}$${(kalshi?.totalPnlUsd ?? 0).toFixed(2)}`, color: (kalshi?.totalPnlUsd ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400' },
            { label: 'Open', value: kalshi?.openPositions?.length ?? 0 },
            { label: '5 Engines', value: 'CFTC Legal' },
          ]}
          link="/polymarket"
          linkLabel="Kalshi Trading"
        />

        <MarketCard
          title="Sports Betting"
          icon={Trophy}
          iconColor="bg-emerald-500/20 text-emerald-400"
          status={(sports?.totalBets ?? 0) > 0 ? 'active' : 'not_configured'}
          stats={[
            { label: 'Bets', value: sports?.totalBets ?? 0 },
            { label: 'P&L', value: `${(sports?.totalPnlUsd ?? 0) >= 0 ? '+' : ''}$${(sports?.totalPnlUsd ?? 0).toFixed(2)}`, color: (sports?.totalPnlUsd ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400' },
            { label: 'Open', value: sports?.openBets?.length ?? 0 },
            { label: '6 Engines', value: 'Odds API' },
          ]}
          link="/sports"
          linkLabel="Sports Intelligence"
        />

        <MarketCard
          title="Arb Intelligence"
          icon={Zap}
          iconColor="bg-cyan-500/20 text-cyan-400"
          status={arb?.running ? 'active' : 'not_configured'}
          stats={[
            { label: 'Scans', value: arb?.scanCycles ?? 0 },
            { label: 'Trades', value: arb?.tradesExecuted ?? 0 },
            { label: '7 Detectors', value: 'Kalshi+Poly' },
            { label: 'Status', value: arb?.running ? 'Scanning' : 'Off', color: arb?.running ? 'text-emerald-400' : 'text-slate-500' },
          ]}
          link="/arb-intel"
          linkLabel="Arb Intelligence"
        />
        {/* Token Factory */}
        <MarketCard
          title="Token Factory"
          icon={Rocket}
          iconColor="bg-purple-500/20 text-purple-400"
          status="active"
          stats={[
            { label: 'Launched', value: '2' },
            { label: 'On-Chain', value: '2' },
            { label: 'Wallet', value: 'PumpPortal' },
            { label: 'Status', value: 'Auto', color: 'text-purple-400' },
          ]}
          link="/launch-coach"
          linkLabel="Launch Coach"
        />
      </div>

      {/* Capital Allocation */}
      <AllocationBar
        segments={segments}
        cashPercent={allocation?.cashReserve?.percent ?? 35}
      />

      {/* Action Items + Live Trades side by side */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ActionItems items={briefing?.actionItems ?? []} />
        <LiveTradesFeed />
      </div>
    </div>
  );
}
