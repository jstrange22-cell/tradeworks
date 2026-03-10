import { useEffect, useState, useCallback } from 'react';
import { Command } from 'cmdk';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ArrowLeftRight, Bot, ShieldAlert, Lightbulb,
  CandlestickChart, Globe, Zap, Settings, Play, Square, ToggleLeft, Search,
} from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { toast } from 'sonner';

interface CommandItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut?: string;
  onSelect: () => void;
}

function engineAction(endpoint: string, successMsg: string, errorMsg: string) {
  apiClient.post(endpoint, {}).then(() => toast.success(successMsg)).catch(() => toast.error(errorMsg));
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const go = useCallback(
    (path: string) => { navigate(path); setOpen(false); },
    [navigate],
  );

  const close = useCallback(() => setOpen(false), []);

  const navigationItems: CommandItem[] = [
    { id: 'nav-dashboard', label: 'Dashboard', icon: LayoutDashboard, shortcut: 'Ctrl+D', onSelect: () => go('/') },
    { id: 'nav-trades', label: 'Trades', icon: ArrowLeftRight, shortcut: 'Ctrl+T', onSelect: () => go('/trades') },
    { id: 'nav-agents', label: 'Agents', icon: Bot, shortcut: 'Ctrl+A', onSelect: () => go('/agents') },
    { id: 'nav-risk', label: 'Risk', icon: ShieldAlert, shortcut: 'Ctrl+R', onSelect: () => go('/risk') },
    { id: 'nav-strategies', label: 'Strategies', icon: Lightbulb, shortcut: 'Ctrl+S', onSelect: () => go('/strategies') },
    { id: 'nav-charts', label: 'Charts', icon: CandlestickChart, shortcut: 'Ctrl+C', onSelect: () => go('/charts') },
    { id: 'nav-markets', label: 'Markets', icon: Globe, shortcut: 'Ctrl+M', onSelect: () => go('/markets') },
    { id: 'nav-solana', label: 'Solana', icon: Zap, shortcut: 'Ctrl+O', onSelect: () => go('/solana') },
    { id: 'nav-settings', label: 'Settings', icon: Settings, onSelect: () => go('/settings') },
  ];

  const actionItems: CommandItem[] = [
    {
      id: 'action-start-engine', label: 'Start Engine', icon: Play,
      onSelect: () => { engineAction('/engine/start', 'Engine started', 'Failed to start engine'); close(); },
    },
    {
      id: 'action-stop-engine', label: 'Stop Engine', icon: Square,
      onSelect: () => { engineAction('/engine/stop', 'Engine stopped', 'Failed to stop engine'); close(); },
    },
    {
      id: 'action-toggle-paper', label: 'Toggle Paper Mode', icon: ToggleLeft,
      onSelect: () => { engineAction('/engine/toggle-paper', 'Paper mode toggled', 'Failed to toggle paper mode'); close(); },
    },
  ];

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100]">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />
      <div className="fixed inset-x-0 top-[20%] mx-auto w-full max-w-lg px-4">
        <Command className="overflow-hidden rounded-xl border border-slate-700/50 bg-slate-900 shadow-2xl" loop>
          <div className="flex items-center gap-2 border-b border-slate-700/50 px-4">
            <Search className="h-4 w-4 shrink-0 text-slate-500" />
            <Command.Input
              placeholder="Search pages and actions..."
              className="h-12 w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
              autoFocus
            />
            <kbd className="hidden shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-400 sm:inline">
              ESC
            </kbd>
          </div>
          <Command.List className="max-h-72 overflow-y-auto p-2">
            <Command.Empty className="px-4 py-8 text-center text-sm text-slate-500">
              No results found.
            </Command.Empty>
            <Command.Group heading="Navigation" className="mb-2">
              {navigationItems.map((item) => <PaletteItem key={item.id} item={item} />)}
            </Command.Group>
            <Command.Group heading="Actions" className="mb-2">
              {actionItems.map((item) => <PaletteItem key={item.id} item={item} />)}
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

function PaletteItem({ item }: { item: CommandItem }) {
  const Icon = item.icon;
  return (
    <Command.Item
      value={item.label}
      onSelect={item.onSelect}
      className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-300 data-[selected=true]:bg-slate-800 data-[selected=true]:text-slate-100"
    >
      <Icon className="h-4 w-4 shrink-0 text-slate-500" />
      <span className="flex-1">{item.label}</span>
      {item.shortcut && (
        <kbd className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
          {item.shortcut}
        </kbd>
      )}
    </Command.Item>
  );
}
