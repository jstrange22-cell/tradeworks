import { useState } from 'react';
import { Plus, Loader2, Key, CheckCircle, XCircle } from 'lucide-react';
import { useApiKeysQuery, useInvalidateApiKeys } from '@/hooks/useApiKeys';
import { SERVICE_INFO } from '@/types/settings';
import { ApiKeyCard } from '@/components/settings/ApiKeyCard';
import { AddKeyModal } from '@/components/settings/AddKeyModal';

const SERVICES = ['coinbase', 'alpaca', 'robinhood', 'polymarket', 'solana'] as const;

interface ApiKeysTabProps {
  initialAddService?: string;
}

export function ApiKeysTab({ initialAddService }: ApiKeysTabProps) {
  const { apiKeys, isLoading } = useApiKeysQuery();
  const invalidateKeys = useInvalidateApiKeys();
  const [addModalService, setAddModalService] = useState<string | undefined>(initialAddService);
  const [showAddModal, setShowAddModal] = useState(!!initialAddService);

  return (
    <>
      <div className="card lg:col-span-2">
        <div className="flex items-center justify-between">
          <div className="card-header">Exchange Connections</div>
          <button
            onClick={() => { setAddModalService(undefined); setShowAddModal(true); }}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            <Plus className="h-4 w-4" />
            Add API Key
          </button>
        </div>

        {/* Connection Checklist */}
        <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {SERVICES.map((svc) => {
            const info = SERVICE_INFO[svc];
            const connected = apiKeys.some((k) => k.service === svc);
            const connectedKey = apiKeys.find((k) => k.service === svc);
            return (
              <div
                key={svc}
                className={`rounded-lg border p-3 ${
                  connected
                    ? 'border-green-500/30 bg-green-500/5'
                    : 'border-slate-700/30 bg-slate-900/20'
                }`}
              >
                <div className="flex items-center gap-2">
                  {connected ? (
                    <CheckCircle className="h-4 w-4 text-green-400" />
                  ) : (
                    <XCircle className="h-4 w-4 text-slate-500" />
                  )}
                  <span className={`text-sm font-semibold ${info.color}`}>{info.label}</span>
                </div>
                {connected ? (
                  <div className="mt-1 text-xs text-green-400/70">
                    Connected ({connectedKey?.environment})
                  </div>
                ) : (
                  <button
                    onClick={() => { setAddModalService(svc); setShowAddModal(true); }}
                    className="mt-1.5 text-xs font-medium text-blue-400 hover:text-blue-300"
                  >
                    + Connect {info.label}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
            <span className="ml-2 text-sm text-slate-400">Loading keys...</span>
          </div>
        ) : apiKeys.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/20 py-8 text-center">
            <Key className="mx-auto h-8 w-8 text-slate-600" />
            <p className="mt-2 text-sm text-slate-400">No API keys configured yet</p>
            <p className="mt-1 text-xs text-slate-500">
              Click an exchange above to add your API keys. Step-by-step guides will walk you through it.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {apiKeys.map((key) => (
              <ApiKeyCard key={key.id} apiKey={key} onDeleted={invalidateKeys} />
            ))}
          </div>
        )}
      </div>

      {showAddModal && (
        <AddKeyModal
          onClose={() => setShowAddModal(false)}
          onSuccess={invalidateKeys}
          preSelectedService={addModalService}
        />
      )}
    </>
  );
}
