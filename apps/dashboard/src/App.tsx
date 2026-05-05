import { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { AppShell } from '@/components/layout/AppShell';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { PageErrorBoundary } from '@/components/ErrorBoundary';
import { SolanaWalletProvider } from '@/providers/SolanaWalletProvider';
import { EVMWalletProvider } from '@/providers/EVMWalletProvider';
import { LoginPage } from '@/pages/LoginPage';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string ?? '';

// ── Active v2 routes ────────────────────────────────────────────────────
// CockpitPage is the new default home (E1, 2026-05-04). DashboardPage is
// preserved at /legacy-dashboard while the v2 cleanup completes; agent E5
// will purge it once StrategyPage / TradesExplorerPage are also live.
const CockpitPage = lazy(() => import('@/pages/CockpitPage').then(m => ({ default: m.CockpitPage })));
const DashboardPage = lazy(() => import('@/pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const TradesPage = lazy(() => import('@/pages/TradesPage').then(m => ({ default: m.TradesPage })));
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const AnalyticsPage = lazy(() => import('@/pages/AnalyticsPage').then(m => ({ default: m.AnalyticsPage })));
const WalletsPage = lazy(() => import('@/pages/WalletsPage').then(m => ({ default: m.WalletsPage })));
const IntelligencePage = lazy(() => import('@/pages/IntelligencePage').then(m => ({ default: m.IntelligencePage })));
const ApexChatPage = lazy(() => import('@/pages/ApexChatPage').then(m => ({ default: m.ApexChatPage })));
const CryptoPage = lazy(() => import('@/pages/CryptoPage').then(m => ({ default: m.CryptoPage })));
const StocksPage = lazy(() => import('@/pages/StocksPage').then(m => ({ default: m.StocksPage })));
const StrategiesIndexPage = lazy(() => import('@/pages/StrategiesIndexPage').then(m => ({ default: m.StrategiesIndexPage })));
const StrategyPage = lazy(() => import('@/pages/StrategyPage').then(m => ({ default: m.StrategyPage })));
const TradesExplorerPage = lazy(() => import('@/pages/TradesExplorerPage').then(m => ({ default: m.TradesExplorerPage })));
const DecisionDetailPage = lazy(() => import('@/pages/DecisionDetailPage').then(m => ({ default: m.DecisionDetailPage })));

// ── Pages shelved 2026-05-04 (task E5a) ────────────────────────────────
// Restore tag: pre-v2-ui-cleanup. Files moved to `_archive/v2-shelved-ui/`.
//
// SolanaPage (already shelved 2026-05-04 task A3 — see _archive/v2-shelved-solana/)
// PolymarketPage / SportsPage / ArbIntelPage / LaunchCoachPage — v1 prediction-
//   market / sports / arbitrage / Solana-launch surfaces removed from v2 scope.
// AgentsPage / RiskPage / StrategiesPage / ChartsPage / MarketsPage / JournalPage —
//   orphans (already only existed as redirects). Cleaned up here.

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
    </div>
  );
}

const P = ({ children }: { children: React.ReactNode }) => (
  <PageErrorBoundary><Suspense fallback={<PageLoader />}>{children}</Suspense></PageErrorBoundary>
);

const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    element: (
      <ProtectedRoute>
        <AppShell />
      </ProtectedRoute>
    ),
    children: [
      { path: '/', element: <P><CockpitPage /></P> },
      { path: '/legacy-dashboard', element: <P><DashboardPage /></P> },
      { path: '/crypto', element: <P><CryptoPage /></P> },
      { path: '/trades', element: <P><TradesPage /></P> },
      // V2 trades & decisions explorer (E4) — auditing surface keyed off the
      // memory DB. /explorer/decisions/:id opens the full detail page.
      { path: '/explorer', element: <P><TradesExplorerPage /></P> },
      { path: '/explorer/decisions/:id', element: <P><DecisionDetailPage /></P> },
      // Legacy redirect for any old `/explorer/:decisionId` style links.
      { path: '/explorer/:decisionId', element: <P><TradesExplorerPage /></P> },
      { path: '/analytics', element: <P><AnalyticsPage /></P> },
      { path: '/intelligence', element: <P><IntelligencePage /></P> },
      { path: '/apex', element: <P><ApexChatPage /></P> },
      { path: '/stocks', element: <P><StocksPage /></P> },
      // V2 strategy lab — bandit-managed strategies (pead, regime_trend, …)
      { path: '/strategies', element: <P><StrategiesIndexPage /></P> },
      { path: '/strategies/:strategyId', element: <P><StrategyPage /></P> },
      { path: '/wallets', element: <P><WalletsPage /></P> },
      { path: '/settings', element: <P><SettingsPage /></P> },
      // /solana shelved 2026-05-04 (task A3); redirect to home so existing
      // links / bookmarks still land somewhere live.
      { path: '/solana', element: <Navigate to="/" replace /> },
    ],
  },
]);

export function App() {
  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <EVMWalletProvider>
        <SolanaWalletProvider>
          <RouterProvider router={router} />
        </SolanaWalletProvider>
      </EVMWalletProvider>
    </GoogleOAuthProvider>
  );
}
