import { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { SolanaWalletProvider } from '@/providers/SolanaWalletProvider';

const DashboardPage = lazy(() => import('@/pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const TradesPage = lazy(() => import('@/pages/TradesPage').then(m => ({ default: m.TradesPage })));
const AgentsPage = lazy(() => import('@/pages/AgentsPage').then(m => ({ default: m.AgentsPage })));
const RiskPage = lazy(() => import('@/pages/RiskPage').then(m => ({ default: m.RiskPage })));
const StrategiesPage = lazy(() => import('@/pages/StrategiesPage').then(m => ({ default: m.StrategiesPage })));
const ChartsPage = lazy(() => import('@/pages/ChartsPage').then(m => ({ default: m.ChartsPage })));
const MarketsPage = lazy(() => import('@/pages/MarketsPage').then(m => ({ default: m.MarketsPage })));
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
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
      { path: '/', element: <Suspense fallback={<PageLoader />}><DashboardPage /></Suspense> },
      { path: '/trades', element: <Suspense fallback={<PageLoader />}><TradesPage /></Suspense> },
      { path: '/agents', element: <Suspense fallback={<PageLoader />}><AgentsPage /></Suspense> },
      { path: '/risk', element: <Suspense fallback={<PageLoader />}><RiskPage /></Suspense> },
      { path: '/strategies', element: <Suspense fallback={<PageLoader />}><StrategiesPage /></Suspense> },
      { path: '/charts', element: <Suspense fallback={<PageLoader />}><ChartsPage /></Suspense> },
      { path: '/markets', element: <Suspense fallback={<PageLoader />}><MarketsPage /></Suspense> },
      { path: '/solana', element: <Suspense fallback={<PageLoader />}><SolanaPage /></Suspense> },
      { path: '/settings', element: <Suspense fallback={<PageLoader />}><SettingsPage /></Suspense> },
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
