import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

// Pruned 2026-05-04 (task E5a). Removed shortcuts for archived pages
// (agents/risk/strategies/charts/markets/solana). Restore tag:
// pre-v2-ui-cleanup.
const SHORTCUTS: Record<string, string> = {
  'd': '/',
  't': '/trades',
  'p': '/apex',       // P → APEX (was 'a' for Agents — repurposed)
  'k': '/crypto',     // K → cryptoCurrency (Ctrl+K is reserved for palette below)
  'b': '/stocks',     // B → stocks/equities
  'i': '/intelligence',
  'w': '/wallets',
};

/**
 * Global keyboard shortcuts.
 *
 * Navigation (Ctrl+Key):
 *   D → Dashboard, T → Trades, P → APEX Chat,
 *   B → Stocks, I → Intelligence, W → Wallets
 *
 * Actions:
 *   Ctrl+K → Command palette (handled by CommandPalette.tsx)
 *   Escape → Close any open modal/overlay
 */
export function useKeyboardShortcuts() {
  const navigate = useNavigate();

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      // Skip if user is typing in an input
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // Ctrl/Cmd + Key navigation
      // Ctrl+K is reserved for the command palette
      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === 'k') return;
        const path = SHORTCUTS[e.key.toLowerCase()];
        if (path) {
          e.preventDefault();
          navigate(path);
        }
      }
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);
}
