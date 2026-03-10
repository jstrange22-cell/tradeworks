import { useState, useEffect, useCallback } from 'react';
import {
  Bell,
  Send,
  MessageSquare,
  Mail,
  Loader2,
  CheckCircle,
  XCircle,
  Save,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type {
  NotificationPreferences,
  NotificationChannel,
  NotificationChannelType,
  NotificationEvent,
  NotificationTestResult,
} from '@/types/settings';
import {
  NOTIFICATION_EVENTS,
  EVENT_LABELS,
} from '@/types/settings';

// ---------------------------------------------------------------------------
// Channel metadata
// ---------------------------------------------------------------------------

interface ChannelMeta {
  type: NotificationChannelType;
  label: string;
  icon: React.ReactNode;
  colorClass: string;
  fields: Array<{ key: string; label: string; placeholder: string; sensitive?: boolean }>;
}

const CHANNEL_META: ChannelMeta[] = [
  {
    type: 'discord',
    label: 'Discord',
    icon: <MessageSquare className="h-5 w-5" />,
    colorClass: 'text-indigo-400',
    fields: [
      {
        key: 'webhookUrl',
        label: 'Webhook URL',
        placeholder: 'https://discord.com/api/webhooks/...',
      },
    ],
  },
  {
    type: 'telegram',
    label: 'Telegram',
    icon: <Send className="h-5 w-5" />,
    colorClass: 'text-sky-400',
    fields: [
      { key: 'botToken', label: 'Bot Token', placeholder: '123456:ABC-DEF...', sensitive: true },
      { key: 'chatId', label: 'Chat ID', placeholder: '-1001234567890' },
    ],
  },
  {
    type: 'email',
    label: 'Email',
    icon: <Mail className="h-5 w-5" />,
    colorClass: 'text-amber-400',
    fields: [
      { key: 'email', label: 'Email Address', placeholder: 'you@example.com' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getChannelFromPrefs(
  channels: NotificationChannel[],
  type: NotificationChannelType,
): NotificationChannel {
  return channels.find((ch) => ch.type === type) ?? { type, enabled: false, config: {} };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NotificationsTab() {
  const queryClient = useQueryClient();

  // ---- Remote state ----
  const { data: prefsResponse, isLoading } = useQuery<{ data: NotificationPreferences }>({
    queryKey: ['notification-preferences'],
    queryFn: () =>
      apiClient.get<{ data: NotificationPreferences }>('/notifications/preferences'),
  });

  // ---- Local state ----
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [subscribedEvents, setSubscribedEvents] = useState<NotificationEvent[]>([]);
  const [saved, setSaved] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, NotificationTestResult | null>>({});

  // Sync remote -> local on load
  useEffect(() => {
    if (prefsResponse?.data) {
      setChannels(prefsResponse.data.channels);
      setSubscribedEvents(prefsResponse.data.subscribedEvents);
    }
  }, [prefsResponse]);

  // ---- Mutations ----
  const saveMutation = useMutation({
    mutationFn: (prefs: NotificationPreferences) =>
      apiClient.put('/notifications/preferences', prefs),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-preferences'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const testMutation = useMutation({
    mutationFn: (payload: { channelType: NotificationChannelType; config: Record<string, string> }) =>
      apiClient.post<{ data: NotificationTestResult }>('/notifications/test', payload),
    onSuccess: (resp, variables) => {
      const result = (resp as { data: NotificationTestResult }).data;
      setTestResults((prev) => ({ ...prev, [variables.channelType]: result }));
    },
    onError: (_err, variables) => {
      setTestResults((prev) => ({
        ...prev,
        [variables.channelType]: {
          success: false,
          channelType: variables.channelType,
          detail: 'Request failed — check gateway logs',
        },
      }));
    },
  });

  // ---- Handlers ----
  const handleSave = useCallback(() => {
    saveMutation.mutate({ channels, subscribedEvents });
  }, [channels, subscribedEvents, saveMutation]);

  const toggleChannel = useCallback((type: NotificationChannelType) => {
    setChannels((prev) =>
      prev.map((ch) => (ch.type === type ? { ...ch, enabled: !ch.enabled } : ch)),
    );
  }, []);

  const updateChannelConfig = useCallback(
    (type: NotificationChannelType, key: string, value: string) => {
      setChannels((prev) =>
        prev.map((ch) =>
          ch.type === type ? { ...ch, config: { ...ch.config, [key]: value } } : ch,
        ),
      );
    },
    [],
  );

  const toggleEvent = useCallback((event: NotificationEvent) => {
    setSubscribedEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event],
    );
  }, []);

  const handleTest = useCallback(
    (type: NotificationChannelType) => {
      const channel = getChannelFromPrefs(channels, type);
      setTestResults((prev) => ({ ...prev, [type]: null }));
      testMutation.mutate({ channelType: type, config: channel.config });
    },
    [channels, testMutation],
  );

  // ---- Render helpers ----

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bell className="h-5 w-5 text-blue-400" />
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Notifications</h2>
            <p className="text-xs text-slate-500">
              Configure where and when TradeWorks sends you alerts.
            </p>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="btn-primary flex items-center gap-2 text-sm"
        >
          {saveMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : saved ? (
            <CheckCircle className="h-3.5 w-3.5 text-green-400" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          {saved ? 'Saved' : 'Save'}
        </button>
      </div>

      {/* Channel cards */}
      <div className="grid gap-4 lg:grid-cols-3">
        {CHANNEL_META.map((meta) => {
          const channel = getChannelFromPrefs(channels, meta.type);
          const result = testResults[meta.type] ?? null;
          const isTesting =
            testMutation.isPending && testMutation.variables?.channelType === meta.type;

          return (
            <ChannelCard
              key={meta.type}
              meta={meta}
              channel={channel}
              testResult={result}
              isTesting={isTesting}
              onToggle={() => toggleChannel(meta.type)}
              onConfigChange={(key, value) => updateChannelConfig(meta.type, key, value)}
              onTest={() => handleTest(meta.type)}
            />
          );
        })}
      </div>

      {/* Event subscriptions */}
      <div className="card">
        <div className="card-header">Event Subscriptions</div>
        <p className="mb-4 text-xs text-slate-500">
          Choose which events trigger a notification across all enabled channels.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {NOTIFICATION_EVENTS.map((event) => (
            <label
              key={event}
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-700/30 bg-slate-900/30 p-3 transition hover:border-slate-600/50"
            >
              <input
                type="checkbox"
                checked={subscribedEvents.includes(event)}
                onChange={() => toggleEvent(event)}
                className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
              />
              <span className="text-sm text-slate-200">{EVENT_LABELS[event]}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChannelCard sub-component
// ---------------------------------------------------------------------------

interface ChannelCardProps {
  meta: ChannelMeta;
  channel: NotificationChannel;
  testResult: NotificationTestResult | null;
  isTesting: boolean;
  onToggle: () => void;
  onConfigChange: (key: string, value: string) => void;
  onTest: () => void;
}

function ChannelCard({
  meta,
  channel,
  testResult,
  isTesting,
  onToggle,
  onConfigChange,
  onTest,
}: ChannelCardProps) {
  return (
    <div className="card space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={meta.colorClass}>{meta.icon}</span>
          <span className="text-sm font-semibold text-slate-100">{meta.label}</span>
        </div>
        <button
          onClick={onToggle}
          aria-label={`Toggle ${meta.label}`}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            channel.enabled ? 'bg-blue-600' : 'bg-slate-700'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              channel.enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Config fields */}
      {meta.fields.map((field) => (
        <div key={field.key}>
          <label className="mb-1 block text-xs font-medium text-slate-400">
            {field.label}
          </label>
          <input
            type={field.sensitive ? 'password' : 'text'}
            value={channel.config[field.key] ?? ''}
            onChange={(e) => onConfigChange(field.key, e.target.value)}
            placeholder={field.placeholder}
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      ))}

      {/* Test button + result */}
      <div className="flex items-center gap-3">
        <button
          onClick={onTest}
          disabled={isTesting}
          className="flex items-center gap-1.5 rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:border-slate-500 hover:text-slate-100 disabled:opacity-50"
        >
          {isTesting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Send className="h-3 w-3" />
          )}
          Test
        </button>

        {testResult && (
          <span
            className={`flex items-center gap-1 text-xs ${
              testResult.success ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {testResult.success ? (
              <CheckCircle className="h-3.5 w-3.5" />
            ) : (
              <XCircle className="h-3.5 w-3.5" />
            )}
            {testResult.detail}
          </span>
        )}
      </div>
    </div>
  );
}
