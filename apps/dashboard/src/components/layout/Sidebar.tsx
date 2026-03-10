import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  ArrowLeftRight,
  Bot,
  ShieldAlert,
  Lightbulb,
  CandlestickChart,
  Globe,
  BarChart3,
  BookOpen,
  Zap,
  Settings,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react';
import { useUIStore } from '@/stores/ui-store';
import { useEffect } from 'react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/trades', icon: ArrowLeftRight, label: 'Trades' },
  { to: '/agents', icon: Bot, label: 'Agents' },
  { to: '/risk', icon: ShieldAlert, label: 'Risk' },
  { to: '/strategies', icon: Lightbulb, label: 'Strategies' },
  { to: '/charts', icon: CandlestickChart, label: 'Charts' },
  { to: '/markets', icon: Globe, label: 'Markets' },
  { to: '/analytics', icon: BarChart3, label: 'Analytics' },
  { to: '/journal', icon: BookOpen, label: 'Journal' },
  { to: '/solana', icon: Zap, label: 'Solana' },
  { to: '/settings', icon: Settings, label: 'Settings' },
] as const;

export function Sidebar() {
  const { sidebarCollapsed: collapsed, toggleSidebar, sidebarOpen, setSidebarOpen } = useUIStore();
  const location = useLocation();

  // Close mobile sidebar on route change
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname, setSidebarOpen]);

  return (
    <>
      {/* Mobile overlay backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`
          fixed inset-y-0 left-0 z-50 flex flex-col border-r border-gray-200 bg-white dark:border-slate-700/50 dark:bg-slate-900 transition-all duration-300
          md:static md:translate-x-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
          ${collapsed ? 'md:w-16 w-56' : 'w-56'}
        `}
      >
        {/* Logo + mobile close */}
        <div className="flex h-14 items-center justify-between border-b border-gray-200 dark:border-slate-700/50 px-4">
          {(!collapsed || sidebarOpen) && (
            <span className="text-lg font-bold tracking-tight text-gray-900 dark:text-slate-100">
              Trade<span className="text-blue-500">Works</span>
            </span>
          )}
          {collapsed && !sidebarOpen && (
            <span className="text-lg font-bold text-blue-500">TW</span>
          )}
          <button
            onClick={() => setSidebarOpen(false)}
            className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 md:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-4">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-600/10 text-blue-400'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'
                } ${collapsed && !sidebarOpen ? 'md:justify-center' : ''}`
              }
              title={collapsed && !sidebarOpen ? label : undefined}
            >
              <Icon className="h-5 w-5 flex-shrink-0" />
              {(!collapsed || sidebarOpen) && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Collapse toggle (desktop only) */}
        <div className="hidden border-t border-gray-200 dark:border-slate-700/50 p-2 md:block">
          <button
            onClick={toggleSidebar}
            className="flex w-full items-center justify-center rounded-md p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
        </div>
      </aside>
    </>
  );
}
