import { useState } from 'react';
import { Trash2, TestTube, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { SERVICE_INFO, type MaskedApiKey, type TestResult } from '@/types/settings';

interface ApiKeyCardProps {
  apiKey: MaskedApiKey;
  onDeleted: () => void;
}

export function ApiKeyCard({ apiKey, onDeleted }: ApiKeyCardProps) {
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const info = SERVICE_INFO[apiKey.service] ?? { label: apiKey.service, color: 'text-slate-400', description: '' };

  const testMutation = useMutation({
    mutationFn: () => apiClient.post<TestResult>(`/settings/api-keys/${apiKey.id}/test`),
    onSuccess: (data) => setTestResult(data),
    onError: () => setTestResult({ success: false, message: 'Connection test failed' }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.delete(`/settings/api-keys/${apiKey.id}`),
    onSuccess: () => onDeleted(),
  });

  const envBadge = {
    production: 'bg-red-500/10 text-red-400',
    sandbox: 'bg-amber-500/10 text-amber-400',
    testnet: 'bg-blue-500/10 text-blue-400',
  }[apiKey.environment] ?? 'bg-slate-500/10 text-slate-400';

  return (
    <div className="rounded-lg border border-slate-700/30 bg-slate-900/30 p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-semibold ${info.color}`}>{info.label}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${envBadge}`}>
              {apiKey.environment}
            </span>
            {testResult && (
              testResult.success ? (
                <CheckCircle className="h-4 w-4 text-green-400" />
              ) : (
                <XCircle className="h-4 w-4 text-red-400" />
              )
            )}
          </div>
          <div className="mt-1 text-xs text-slate-400">{apiKey.keyName}</div>
          <div className="mt-0.5 font-mono text-xs text-slate-500">{apiKey.maskedKey}</div>
          {testResult && (
            <div className={`mt-2 text-xs ${testResult.success ? 'text-green-400' : 'text-red-400'}`}>
              {testResult.message}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button onClick={() => testMutation.mutate()} disabled={testMutation.isPending}
            className="btn-ghost p-2" title="Test connection">
            {testMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
            ) : (
              <TestTube className="h-4 w-4 text-blue-400" />
            )}
          </button>

          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <button onClick={() => { deleteMutation.mutate(); setConfirmDelete(false); }}
                className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-500">Confirm</button>
              <button onClick={() => setConfirmDelete(false)}
                className="rounded bg-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-600">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)} disabled={deleteMutation.isPending}
              className="btn-ghost p-2" title="Delete key">
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin text-red-400" />
              ) : (
                <Trash2 className="h-4 w-4 text-red-400" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
