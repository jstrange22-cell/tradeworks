import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'dark' | 'light';

interface UIState {
  sidebarCollapsed: boolean;
  sidebarOpen: boolean; // mobile overlay
  theme: Theme;
  /** APEX chat panel visible (right-pinned). Persisted across sessions. */
  apexChatOpen: boolean;
  /** APEX chat history sidebar (inside the chat panel) collapsed. */
  apexHistoryCollapsed: boolean;

  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSidebarOpen: (open: boolean) => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  toggleApexChat: () => void;
  setApexChatOpen: (open: boolean) => void;
  toggleApexHistory: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      sidebarOpen: false,
      theme: 'dark',
      apexChatOpen: true,
      apexHistoryCollapsed: true,

      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      setTheme: (theme) => {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        set({ theme });
      },
      toggleTheme: () =>
        set((s) => {
          const next = s.theme === 'dark' ? 'light' : 'dark';
          document.documentElement.classList.toggle('dark', next === 'dark');
          return { theme: next };
        }),
      toggleApexChat: () => set((s) => ({ apexChatOpen: !s.apexChatOpen })),
      setApexChatOpen: (apexChatOpen) => set({ apexChatOpen }),
      toggleApexHistory: () => set((s) => ({ apexHistoryCollapsed: !s.apexHistoryCollapsed })),
    }),
    {
      name: 'tradeworks-ui',
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        theme: state.theme,
        apexChatOpen: state.apexChatOpen,
        apexHistoryCollapsed: state.apexHistoryCollapsed,
      }),
    },
  ),
);
