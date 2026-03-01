import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  ArrowLeftRight,
  Bot,
  ShieldAlert,
  Lightbulb,
  CandlestickChart,
  Globe,
  Settings,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/trades', icon: ArrowLeftRight, label: 'Trades' },
  { to: '/agents', icon: Bot, label: 'Agents' },
  { to: '/risk', icon: ShieldAlert, label: 'Risk' },
  { to: '/strategies', icon: Lightbulb, label: 'Strategies' },
  { to: '/charts', icon: CandlestickChart, label: 'Charts' },
  { to: '/markets', icon: Globe, label: 'Markets' },
  { to: '/settings', icon: Settings, label: 'Settings' },
] as const;

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`flex h-screen flex-col border-r border-slate-700/50 bg-slate-900 transition-all duration-300 ${
        collapsed ? 'w-16' : 'w-56'
      }`}
    >
      {/* Logo */}
      <div className="flex h-14 items-center border-b border-slate-700/50 px-4">
        {!collapsed && (
          <span className="text-lg font-bold tracking-tight text-slate-100">
            Trade<span className="text-blue-500">Works</span>
          </span>
        )}
        {collapsed && (
          <span className="text-lg font-bold text-blue-500">TW</span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-2 py-4">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-600/10 text-blue-400'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              } ${collapsed ? 'justify-center' : ''}`
            }
            title={collapsed ? label : undefined}
          >
            <Icon className="h-5 w-5 flex-shrink-0" />
            {!collapsed && <span>{label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Collapse toggle */}
      <div className="border-t border-slate-700/50 p-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex w-full items-center justify-center rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </div>
    </aside>
  );
}
