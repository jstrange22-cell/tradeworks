import { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { PageErrorBoundary } from '@/components/ErrorBoundary';
import { SolanaWalletProvider } from '@/providers/SolanaWalletProvider';

const DashboardPage = lazy(() => import('@/pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const TradesPage = lazy(() => import('@/pages/TradesPage').then(m => ({ default: m.TradesPage })));
const AgentsPage = lazy(() => import('@/pages/AgentsPage').then(m => ({ default: m.AgentsPage })));
const RiskPage = lazy(() => import('@/pages/RiskPage').then(m => ({ default: m.RiskPage })));
const StrategiesPage = lazy(() => import('@/pages/StrategiesPage').then(m => ({ default: m.StrategiesPage })));
const ChartsPage = lazy(() => import('@/pages/ChartsPage').then(m => ({ default: m.ChartsPage })));
const MarketsPage = lazy(() => import('@/pages/MarketsPage').then(m => ({ default: m.MarketsPage })));
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const AnalyticsPage = lazy(() => import('@/pages/AnalyticsPage').then(m => ({ default: m.AnalyticsPage })));
const JournalPage = lazy(() => import('@/pages/JournalPage').then(m => ({ default: m.JournalPage })));
const SolanaPage = lazy(() => import('@/pages/SolanaPage').then(m => ({ default: m.SolanaPage })));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <PageErrorBoundary><Suspense fallback={<PageLoader />}><DashboardPage /></Suspense></PageErrorBoundary> },
      { path: '/trades', element: <PageErrorBoundary><Suspense fallback={<PageLoader />}><TradesPage /></Suspense></PageErrorBoundary> },
      { path: '/agents', element: <PageErrorBoundary><Suspense fallback={<PageLoader />}><AgentsPage /></Suspense></PageErrorBoundary> },
      { path: '/risk', element: <PageErrorBoundary><Suspense fallback={<PageLoader />}><RiskPage /></Suspense></PageErrorBoundary> },
      { path: '/strategies', element: <PageErrorBoundary><Suspense fallback={<PageLoader />}><StrategiesPage /></Suspense></PageErrorBoundary> },
      { path: '/charts', element: <PageErrorBoundary><Suspense fallback={<PageLoader />}><ChartsPage /></Suspense></PageErrorBoundary> },
      { path: '/markets', element: <PageErrorBoundary><Suspense fallback={<PageLoader />}><MarketsPage /></Suspense></PageErrorBoundary> },
      { path: '/analytics', element: <PageErrorBoundary><Suspense fallback={<PageLoader />}><AnalyticsPage /></Suspense></PageErrorBoundary> },
      { path: '/journal', element: <PageErrorBoundary><Suspense fallback={<PageLoader />}><JournalPage /></Suspense></PageErrorBoundary> },
      { path: '/solana', element: <PageErrorBoundary><Suspense fallback={<PageLoader />}><SolanaPage /></Suspense></PageErrorBoundary> },
      { path: '/settings', element: <PageErrorBoundary><Suspense fallback={<PageLoader />}><SettingsPage /></Suspense></PageErrorBoundary> },
    ],
  },
]);

export function App() {
  return (
    <SolanaWalletProvider>
      <RouterProvider router={router} />
    </SolanaWalletProvider>
  );
}
