import { Save, Loader2 } from 'lucide-react';

interface NotificationItem {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}

interface NotificationsSectionProps {
  items: NotificationItem[];
  onSave: () => void;
  isPending: boolean;
}

export function NotificationsSection({ items, onSave, isPending }: NotificationsSectionProps) {
  return (
    <div className="card lg:col-span-2">
      <div className="flex items-center justify-between">
        <div className="card-header">Notification Preferences</div>
        <button onClick={onSave} disabled={isPending}
          className="btn-primary flex items-center gap-2 text-sm">
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          Save
        </button>
      </div>
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.label}
            className="flex items-center justify-between rounded-lg border border-slate-700/30 bg-slate-900/30 p-3">
            <div>
              <div className="text-sm font-medium text-slate-200">{item.label}</div>
              <div className="text-xs text-slate-500">{item.desc}</div>
            </div>
            <button onClick={() => item.onChange(!item.checked)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                item.checked ? 'bg-blue-600' : 'bg-slate-700'
              }`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                item.checked ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
