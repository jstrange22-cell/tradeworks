import { lazy, Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { Toaster } from 'sonner';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { CommandPalette } from '@/components/CommandPalette';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useApexStream } from '@/hooks/useApexStream';
import { useUIStore } from '@/stores/ui-store';

// Lazy-load the chat panel — keeps the initial dashboard bundle lean.
const ApexChatPanel = lazy(() =>
  import('@/components/apex-chat/ApexChatPanel').then((m) => ({ default: m.ApexChatPanel })),
);

export function AppShell() {
  useWebSocket();
  useKeyboardShortcuts();
  // Single SSE subscription for the whole authenticated app — pushes
  // decision-created / outcome-written / regime-changed / bandit-recomputed /
  // kill-switch-changed / execution-filled events into the TanStack Query
  // cache so polling becomes a fallback rather than the primary source of
  // truth. See `hooks/useApexStream.ts` for the dispatch table.
  useApexStream();
  const { theme, apexChatOpen } = useUIStore();

  // Reserve gutter on xl+ when panel is open so page content doesn't sit
  // underneath it. Below xl the panel overlays the screen.
  const mainPaddingRight = apexChatOpen ? 'xl:pr-[380px]' : '';

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-slate-900">
      <Sidebar />
      <div className={`flex flex-1 flex-col overflow-hidden ${mainPaddingRight}`}>
        <Header />
        <main className="flex-1 overflow-y-auto p-2 md:p-6">
          <Outlet />
        </main>
      </div>
      <Suspense fallback={null}>
        <ApexChatPanel />
      </Suspense>
      <CommandPalette />
      <Toaster
        position="bottom-right"
        theme={theme}
        toastOptions={{
          style: theme === 'dark'
            ? {
                background: '#1e293b',
                border: '1px solid rgba(51, 65, 85, 0.5)',
                color: '#e2e8f0',
              }
            : {
                background: '#ffffff',
                border: '1px solid #e5e7eb',
                color: '#111827',
              },
        }}
      />
    </div>
  );
}
