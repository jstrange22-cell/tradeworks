import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const SHORTCUTS: Record<string, string> = {
  'd': '/',
  't': '/trades',
  'a': '/agents',
  'r': '/risk',
  's': '/strategies',
  'c': '/charts',
  'm': '/markets',
  'o': '/solana',
};

/**
 * Global keyboard shortcuts.
 *
 * Navigation (Ctrl+Key):
 *   D → Dashboard, T → Trades, A → Agents, R → Risk,
 *   S → Strategies, C → Charts, M → Markets, O → Solana
 *
 * Actions:
 *   Escape → Close any open modal/overlay
 *   ? → Show shortcut cheat sheet (future)
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
