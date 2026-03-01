import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { DashboardPage } from '@/pages/DashboardPage';
import { TradesPage } from '@/pages/TradesPage';
import { AgentsPage } from '@/pages/AgentsPage';
import { RiskPage } from '@/pages/RiskPage';
import { StrategiesPage } from '@/pages/StrategiesPage';
import { ChartsPage } from '@/pages/ChartsPage';
import { MarketsPage } from '@/pages/MarketsPage';
import { SettingsPage } from '@/pages/SettingsPage';

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <DashboardPage /> },
      { path: '/trades', element: <TradesPage /> },
      { path: '/agents', element: <AgentsPage /> },
      { path: '/risk', element: <RiskPage /> },
      { path: '/strategies', element: <StrategiesPage /> },
      { path: '/charts', element: <ChartsPage /> },
      { path: '/markets', element: <MarketsPage /> },
      { path: '/settings', element: <SettingsPage /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
