import { useEffect, useRef, useCallback } from 'react';

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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasChangedRef = useRef(false);

  const debouncedSave = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onSave();
      hasChangedRef.current = false;
    }, 500);
  }, [onSave]);

  // Auto-save when any toggle changes
  useEffect(() => {
    if (hasChangedRef.current) {
      debouncedSave();
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [items, debouncedSave]);

  const handleToggle = (item: NotificationItem) => {
    hasChangedRef.current = true;
    item.onChange(!item.checked);
  };

  return (
    <div className="card lg:col-span-2">
      <div className="flex items-center justify-between">
        <div className="card-header">Notification Preferences</div>
        {isPending && (
          <span className="text-xs text-gray-400 dark:text-slate-500">Saving...</span>
        )}
      </div>
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.label}
            className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50/50 dark:border-slate-700/30 dark:bg-slate-900/30 p-3">
            <div>
              <div className="text-sm font-medium text-gray-800 dark:text-slate-200">{item.label}</div>
              <div className="text-xs text-gray-500 dark:text-slate-500">{item.desc}</div>
            </div>
            <button onClick={() => handleToggle(item)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                item.checked ? 'bg-blue-600' : 'bg-gray-300 dark:bg-slate-700'
              }`}
              role="switch"
              aria-checked={item.checked}
              aria-label={item.label}>
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
