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

const DashboardPage = lazy(() => import('@/pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const TradesPage = lazy(() => import('@/pages/TradesPage').then(m => ({ default: m.TradesPage })));
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const AnalyticsPage = lazy(() => import('@/pages/AnalyticsPage').then(m => ({ default: m.AnalyticsPage })));
const SolanaPage = lazy(() => import('@/pages/SolanaPage').then(m => ({ default: m.SolanaPage })));
const WalletsPage = lazy(() => import('@/pages/WalletsPage').then(m => ({ default: m.WalletsPage })));
const PolymarketPage = lazy(() => import('@/pages/PolymarketPage').then(m => ({ default: m.PolymarketPage })));
const IntelligencePage = lazy(() => import('@/pages/IntelligencePage').then(m => ({ default: m.IntelligencePage })));
const ApexChatPage = lazy(() => import('@/pages/ApexChatPage').then(m => ({ default: m.ApexChatPage })));
const CryptoPage = lazy(() => import('@/pages/CryptoPage').then(m => ({ default: m.CryptoPage })));
const ArbIntelPage = lazy(() => import('@/pages/ArbIntelPage').then(m => ({ default: m.ArbIntelPage })));
const StocksPage = lazy(() => import('@/pages/StocksPage').then(m => ({ default: m.StocksPage })));
const SportsPage = lazy(() => import('@/pages/SportsPage').then(m => ({ default: m.SportsPage })));
const LaunchCoachPage = lazy(() => import('@/pages/LaunchCoachPage').then(m => ({ default: m.LaunchCoachPage })));

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
      { path: '/', element: <P><DashboardPage /></P> },
      { path: '/crypto', element: <P><CryptoPage /></P> },
      { path: '/solana', element: <P><SolanaPage /></P> },
      { path: '/launch-coach', element: <P><LaunchCoachPage /></P> },
      { path: '/polymarket', element: <P><PolymarketPage /></P> },
      { path: '/trades', element: <P><TradesPage /></P> },
      { path: '/analytics', element: <P><AnalyticsPage /></P> },
      { path: '/intelligence', element: <P><IntelligencePage /></P> },
      { path: '/apex', element: <P><ApexChatPage /></P> },
      { path: '/arb-intel', element: <P><ArbIntelPage /></P> },
      { path: '/stocks', element: <P><StocksPage /></P> },
      { path: '/sports', element: <P><SportsPage /></P> },
      { path: '/wallets', element: <P><WalletsPage /></P> },
      { path: '/settings', element: <P><SettingsPage /></P> },
      // Redirects for removed pages → Command Center
      { path: '/agents', element: <Navigate to="/intelligence" replace /> },
      { path: '/risk', element: <Navigate to="/" replace /> },
      { path: '/strategies', element: <Navigate to="/solana" replace /> },
      { path: '/charts', element: <Navigate to="/analytics" replace /> },
      { path: '/markets', element: <Navigate to="/" replace /> },
      { path: '/journal', element: <Navigate to="/analytics" replace /> },
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
