import { Outlet } from 'react-router-dom';
import { Toaster } from 'sonner';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { CommandPalette } from '@/components/CommandPalette';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';

export function AppShell() {
  useWebSocket();
  useKeyboardShortcuts();

  return (
    <div className="flex h-screen overflow-hidden bg-slate-900">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
      <CommandPalette />
      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          style: {
            background: '#1e293b',
            border: '1px solid rgba(51, 65, 85, 0.5)',
            color: '#e2e8f0',
          },
        }}
      />
    </div>
  );
}
