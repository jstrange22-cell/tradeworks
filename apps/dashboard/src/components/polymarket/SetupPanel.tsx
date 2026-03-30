import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TrendingUp, Key, AlertTriangle, CheckCircle, Loader2, Eye, EyeOff } from 'lucide-react';
import { apiClient } from '@/lib/api-client';

interface SetupResponse {
  data: { connected: boolean; funderAddress: string };
  message: string;
}

export function SetupPanel() {
  const queryClient = useQueryClient();
  const [privateKey, setPrivateKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [connected, setConnected] = useState<string | null>(null);

  const setupMutation = useMutation({
    mutationFn: (key: string) =>
      apiClient.post<SetupResponse>('/polymarket/setup', { privateKey: key }),
    onSuccess: (data) => {
      const addr = data?.data?.funderAddress ?? '';
      setConnected(addr);
      setPrivateKey('');
      queryClient.invalidateQueries({ queryKey: ['polymarket-status'] });
      queryClient.invalidateQueries({ queryKey: ['polymarket-balance'] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!privateKey.trim()) return;
    setupMutation.mutate(privateKey.trim());
  };

  if (connected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <CheckCircle className="h-16 w-16 text-green-400" />
        <h2 className="text-xl font-bold text-slate-100">Polymarket Connected</h2>
        <p className="text-slate-400 text-sm font-mono">{connected}</p>
        <p className="text-slate-500 text-xs text-center max-w-sm">
          Loading your markets and positions…
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] max-w-md mx-auto space-y-6 px-4">
      <div className="text-center space-y-2">
        <TrendingUp className="h-12 w-12 text-blue-400 mx-auto" />
        <h2 className="text-2xl font-bold text-slate-100">Connect Polymarket</h2>
        <p className="text-slate-400 text-sm">
          Enter your Polygon wallet private key to start trading prediction markets.
        </p>
      </div>

      <div className="w-full rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-400 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-amber-300 space-y-1">
            <p className="font-semibold">Security Notice</p>
            <p>Your key is encrypted at rest and never transmitted in plaintext. Use a dedicated wallet — do not use your main Ethereum wallet.</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="w-full space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-300 flex items-center gap-2">
            <Key className="h-4 w-4" />
            Polygon Private Key
          </label>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              placeholder="0x..."
              className="w-full rounded-lg bg-slate-800 border border-slate-600 px-4 py-3 pr-12 text-slate-100 text-sm font-mono placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              disabled={setupMutation.isPending}
            />
            <button
              type="button"
              onClick={() => setShowKey(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {setupMutation.isError && (
          <p className="text-sm text-red-400">
            {(setupMutation.error as Error)?.message ?? 'Setup failed. Check your private key.'}
          </p>
        )}

        <button
          type="submit"
          disabled={!privateKey.trim() || setupMutation.isPending}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:text-slate-500 px-6 py-3 text-sm font-semibold text-white transition-colors"
        >
          {setupMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Connecting…
            </>
          ) : (
            <>
              <TrendingUp className="h-4 w-4" />
              Connect Wallet
            </>
          )}
        </button>
      </form>

      <p className="text-xs text-slate-500 text-center">
        Need a Polygon wallet? Create one at{' '}
        <a
          href="https://metamask.io"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:underline"
        >
          MetaMask
        </a>{' '}
        and fund it with USDC on Polygon.
      </p>
    </div>
  );
}
