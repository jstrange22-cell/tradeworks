import { type LucideIcon, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';

interface StatItem {
  label: string;
  value: string | number;
  color?: string;
}

interface MarketCardProps {
  title: string;
  icon: LucideIcon;
  iconColor: string;
  status: 'active' | 'not_configured' | 'paused';
  stats: StatItem[];
  link: string;
  linkLabel?: string;
}

export function MarketCard({ title, icon: Icon, iconColor, status, stats, link, linkLabel }: MarketCardProps) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4 transition-colors hover:border-slate-600/50">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className={`rounded-lg p-1.5 ${iconColor}`}>
            <Icon className="h-4 w-4" />
          </div>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
          status === 'active' ? 'bg-emerald-500/20 text-emerald-400' :
          status === 'paused' ? 'bg-amber-500/20 text-amber-400' :
          'bg-slate-600/30 text-slate-500'
        }`}>
          {status === 'active' ? 'Live' : status === 'paused' ? 'Paused' : 'Setup Required'}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {stats.map((stat) => (
          <div key={stat.label}>
            <div className={`text-lg font-bold ${stat.color ?? 'text-white'}`}>{stat.value}</div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500">{stat.label}</div>
          </div>
        ))}
      </div>

      <Link
        to={link}
        className="mt-3 flex items-center justify-between rounded-lg bg-slate-700/30 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:bg-slate-700/50 hover:text-white"
      >
        <span>{linkLabel ?? `Open ${title}`}</span>
        <ChevronRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
