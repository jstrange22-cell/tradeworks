/**
 * CockpitPage — the new default home for TradeWorks v2.
 *
 * One-screen P&L cockpit: hero P&L, equity sparkline, drawdown gauge, bandit
 * weights, heat panel, regime pill, kill switch, decisions feed, open
 * positions. Polls every 5s for hot data, 30s for slow data. SSE replacement
 * is wired by E5 in a follow-up.
 *
 * Layout: 12-column grid on lg+, stacked on mobile. P&L hero is always top.
 */
import { useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { DecisionsFeed } from '@/components/cockpit/DecisionsFeed';
import { DrawdownGauge } from '@/components/cockpit/DrawdownGauge';
import { EquityCurveCard } from '@/components/cockpit/EquityCurveCard';
import { HeatPanel } from '@/components/cockpit/HeatPanel';
import { KillSwitchButton } from '@/components/cockpit/KillSwitchButton';
import { PnlHero } from '@/components/cockpit/PnlHero';
import { RegimePill } from '@/components/cockpit/RegimePill';
import { StrategyBanditWeights } from '@/components/cockpit/StrategyBanditWeights';
import { TopPositionsList } from '@/components/cockpit/TopPositionsList';
import {
  useBanditWeights,
  useExitMonitorStatus,
  useKillSwitchStatus,
  usePortfolioHeat,
  usePortfolioSummary,
  useRegime,
  useTradevisorDecisions,
} from '@/components/cockpit/hooks';

export function CockpitPage() {
  const portfolio = usePortfolioSummary();
  const decisions = useTradevisorDecisions(20);
  const regime = useRegime();
  const heat = usePortfolioHeat();
  const bandit = useBanditWeights();
  const killSwitches = useKillSwitchStatus();
  const exits = useExitMonitorStatus();

  // ── Error toast ────────────────────────────────────────────────────────
  // Surface a single, debounced toast when any cockpit query fails. We DO NOT
  // crash the page or show an inline banner over content — the cockpit needs
  // to render skeletons even when the gateway is offline.
  const queries = useMemo(
    () => [portfolio, decisions, regime, heat, bandit, killSwitches, exits],
    [portfolio, decisions, regime, heat, bandit, killSwitches, exits],
  );

  const lastErrorAtRef = useRef<number>(0);
  useEffect(() => {
    const failing = queries.find((q) => q.isError);
    if (!failing) return;
    const now = Date.now();
    if (now - lastErrorAtRef.current < 30_000) return;
    lastErrorAtRef.current = now;
    toast.error('Cockpit data unavailable — gateway not responding.', {
      description:
        failing.error instanceof Error ? failing.error.message : undefined,
    });
  }, [queries]);

  const portfolioData = portfolio.data;
  const banditData = bandit.data?.data;
  const heatData = heat.data?.data;
  const regimeData = regime.data?.data;
  const killStatus = killSwitches.data?.data;
  const decisionList = decisions.data?.data;
  const exitsStatus = exits.data?.data;

  return (
    <div className="space-y-5 pb-8">
      {/* ── Top bar: regime pill + kill switch ─────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold tracking-tight text-white sm:text-xl">
            Cockpit
          </h1>
          <RegimePill regime={regimeData} isLoading={regime.isLoading} />
          {exitsStatus ? (
            <span
              className={`hidden items-center gap-1 text-[11px] sm:inline-flex ${
                exitsStatus.running ? 'text-emerald-400' : 'text-slate-500'
              }`}
              title={
                exitsStatus.lastTickError
                  ? `Exit monitor error: ${exitsStatus.lastTickError}`
                  : `Exit monitor running, ${exitsStatus.exitsTotal} exits fired`
              }
            >
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${
                  exitsStatus.running ? 'animate-pulse bg-emerald-400' : 'bg-slate-600'
                }`}
              />
              exit monitor {exitsStatus.running ? 'live' : 'idle'}
            </span>
          ) : null}
        </div>
        <KillSwitchButton status={killStatus} />
      </div>

      {/* ── P&L hero ──────────────────────────────────────────────────── */}
      <PnlHero data={portfolioData} isLoading={portfolio.isLoading} />

      {/* ── Equity curve + drawdown ───────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <EquityCurveCard
            points={portfolioData?.equityCurve}
            isLoading={portfolio.isLoading}
          />
        </div>
        <DrawdownGauge data={killStatus} isLoading={killSwitches.isLoading} />
      </div>

      {/* ── Bandit weights ───────────────────────────────────────────── */}
      <StrategyBanditWeights data={banditData} isLoading={bandit.isLoading} />

      {/* ── Heat + open positions ────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <HeatPanel data={heatData} isLoading={heat.isLoading} />
        <div className="lg:col-span-2">
          <TopPositionsList
            positions={portfolioData?.openPositions}
            isLoading={portfolio.isLoading}
          />
        </div>
      </div>

      {/* ── Decisions feed ──────────────────────────────────────────── */}
      <DecisionsFeed data={decisionList} isLoading={decisions.isLoading} />
    </div>
  );
}
