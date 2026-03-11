import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePortfolio } from '@/hooks/usePortfolio';
import { apiClient } from '@/lib/api-client';
import { GettingStartedWizard } from '@/components/onboarding/GettingStartedWizard';
import { WalletOverview } from '@/components/portfolio/WalletOverview';
import { CryptoPortfolioPanel } from '@/components/portfolio/CryptoPortfolioPanel';
import { PortfolioSummary } from '@/components/dashboard/PortfolioSummary';
import { EquityCurveChart } from '@/components/dashboard/EquityCurveChart';
import { AssetAllocationChart } from '@/components/dashboard/AssetAllocationChart';
import { RecentTradesTable } from '@/components/dashboard/RecentTradesTable';
import { OpenPositionsTable } from '@/components/dashboard/OpenPositionsTable';
import { EngineStatusCard } from '@/components/dashboard/EngineStatusCard';

interface ApiKeysResponse {
  data: Array<{ id: string; service: string; keyName: string; maskedKey: string; environment: string; createdAt: string }>;
  total: number;
}

export function DashboardPage() {
  const {
    equity,
    initialCapital,
    dailyPnl,
    dailyPnlPercent,
    totalTrades,
    winRate,
    openPositions,
    recentTrades,
    equityCurve,
  } = usePortfolio();

  const [onboardingComplete, setOnboardingComplete] = useState(
    () => localStorage.getItem('tradeworks_onboarding_complete') === 'true'
  );

  const { data: apiKeysData } = useQuery<ApiKeysResponse>({
    queryKey: ['api-keys'],
    queryFn: () => apiClient.get<ApiKeysResponse>('/settings/api-keys'),
  });

  const connectedExchanges = (apiKeysData?.data ?? []).map((k) => k.service);
  const hasNoKeys = connectedExchanges.length === 0;
  const hasSolana = connectedExchanges.includes('solana');

  const isEmpty = equity === 0 && totalTrades === 0 && openPositions.length === 0;
  const showWizard = isEmpty && hasNoKeys && !onboardingComplete;

  const handleOnboardingComplete = () => {
    localStorage.setItem('tradeworks_onboarding_complete', 'true');
    setOnboardingComplete(true);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-100">Portfolio Overview</h1>

      {showWizard && (
        <GettingStartedWizard
          onComplete={handleOnboardingComplete}
          onOpenAddKey={(service) => {
            window.location.href = `/settings?addKey=${service}`;
          }}
          connectedExchanges={connectedExchanges}
        />
      )}

      {isEmpty && !showWizard && (
        <div className="card border-blue-500/30 bg-blue-500/5 py-8 text-center">
          <h2 className="text-lg font-semibold text-slate-200">Welcome to TradeWorks</h2>
          <p className="mt-2 text-sm text-slate-400">
            {hasNoKeys ? (
              <>
                Add your exchange API keys in{' '}
                <a href="/settings" className="text-blue-400 underline hover:text-blue-300">Settings</a>{' '}
                to get started with trading.
              </>
            ) : (
              <>
                Your exchanges are connected! Start the{' '}
                <a href="/agents" className="text-blue-400 underline hover:text-blue-300">AI Engine</a>{' '}
                or place a manual trade from{' '}
                <a href="/charts" className="text-blue-400 underline hover:text-blue-300">Charts</a>.
              </>
            )}
          </p>
        </div>
      )}

      <PortfolioSummary
        equity={equity}
        initialCapital={initialCapital}
        dailyPnl={dailyPnl}
        dailyPnlPercent={dailyPnlPercent}
        openPositions={openPositions}
        winRate={winRate}
        totalTrades={totalTrades}
      />

      <WalletOverview />

      <CryptoPortfolioPanel />

      <EngineStatusCard hasSolana={hasSolana} />

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <EquityCurveChart equityCurve={equityCurve} />
        <AssetAllocationChart openPositions={openPositions} equity={equity} />
      </div>

      <RecentTradesTable recentTrades={recentTrades} />
      <OpenPositionsTable openPositions={openPositions} />
    </div>
  );
}
