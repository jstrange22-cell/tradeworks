import { useState, useEffect } from 'react';
import { Settings, Save, Plus, Trash2, TestTube, Loader2, CheckCircle, XCircle, Key, ExternalLink, Info, Shield, ShieldOff, Lock, Unlock, Camera, DollarSign, Sparkles, AlertTriangle, Copy } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { usePortfolioStore } from '@/stores/portfolio-store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MaskedApiKey {
  id: string;
  service: string;
  keyName: string;
  maskedKey: string;
  environment: string;
  createdAt: string;
}

interface ApiKeysResponse {
  data: MaskedApiKey[];
  total: number;
}

interface TestResult {
  success: boolean;
  message: string;
}

interface RiskLimits {
  maxRiskPerTrade: number;
  dailyLossCap: number;
  weeklyLossCap: number;
  maxPortfolioHeat: number;
  minRiskReward: number;
  maxCorrelation: number;
}

interface ProtectedAsset {
  symbol: string;
  locked: boolean;
  snapshotQuantity: number;
  snapshotValueUsd: number;
}

interface AssetProtectionConfig {
  engineTradingEnabled: boolean;
  tradingBudgetUsd: number;
  budgetUsedUsd: number;
  protectedAssets: Record<string, ProtectedAsset>;
  enginePositions: unknown[];
  snapshotTakenAt: string | null;
}

// ---------------------------------------------------------------------------
// Service display config
// ---------------------------------------------------------------------------

const SERVICE_INFO: Record<string, { label: string; color: string; description: string }> = {
  coinbase: { label: 'Coinbase', color: 'text-blue-400', description: 'Cryptocurrency trading via Coinbase Advanced' },
  alpaca: { label: 'Alpaca', color: 'text-green-400', description: 'Stock & ETF trading via Alpaca' },
  robinhood: { label: 'Robinhood', color: 'text-emerald-400', description: 'Crypto trading via Robinhood Crypto API (crypto only — use Alpaca for stocks)' },
  polymarket: { label: 'Polymarket', color: 'text-purple-400', description: 'Prediction market trading via Polymarket CLOB' },
  solana: { label: 'Solana', color: 'text-violet-400', description: 'Solana meme coin trading via bot wallet' },
};

// ---------------------------------------------------------------------------
// Per-exchange setup guides
// ---------------------------------------------------------------------------

const EXCHANGE_SETUP_GUIDES: Record<string, { steps: { text: string; link?: string }[]; fields: string[] }> = {
  coinbase: {
    steps: [
      { text: 'Go to Coinbase CDP Portal and create a new API key', link: 'https://portal.cdp.coinbase.com/access/api' },
      { text: 'Select permissions: View and Trade (minimum required)' },
      { text: 'Copy the Key ID (UUID format) and paste below' },
      { text: 'Copy the API Secret (shown only once!) and paste below' },
      { text: 'For testing: select "Sandbox" environment below' },
    ],
    fields: ['apiKey', 'apiSecret'],
  },
  alpaca: {
    steps: [
      { text: 'Create a free account at Alpaca', link: 'https://alpaca.markets' },
      { text: 'Go to your Paper Trading dashboard', link: 'https://app.alpaca.markets/paper/dashboard/overview' },
      { text: 'Click "Generate API Keys" in the sidebar' },
      { text: 'Copy the Key ID and paste in "API Key" below' },
      { text: 'Copy the Secret Key and paste in "API Secret" below' },
      { text: 'For paper trading: select "Sandbox" environment below' },
    ],
    fields: ['apiKey', 'apiSecret'],
  },
  robinhood: {
    steps: [
      { text: 'Go to Robinhood Crypto Trading API portal', link: 'https://robinhood.com/account/crypto-api' },
      { text: 'Generate an API key pair (ED25519)' },
      { text: 'Copy the API Key and paste below' },
      { text: 'Copy the Private Key (PEM format) and paste in "API Secret" below' },
      { text: 'Note: This is for CRYPTO trading only. For stocks/ETFs, use Alpaca.' },
    ],
    fields: ['apiKey', 'apiSecret'],
  },
  polymarket: {
    steps: [
      { text: 'Go to Polymarket and connect a crypto wallet', link: 'https://polymarket.com' },
      { text: 'Navigate to Settings and generate CLOB API credentials' },
      { text: 'Copy the API Key, API Secret, and Passphrase' },
      { text: 'You need USDC on Polygon network for trading' },
    ],
    fields: ['apiKey', 'apiSecret', 'passphrase'],
  },
  solana: {
    steps: [
      { text: '⚡ Method A — Generate: Click "Generate Wallet" below to create a new keypair instantly' },
      { text: '🦊 Method B — Phantom: Open Phantom → Settings → Security → Export Private Key → Paste below' },
      { text: '💻 Method C — CLI: Run "solana-keygen new" and paste the base58 private key', link: 'https://docs.solanalabs.com/cli/wallets/file-system' },
      { text: 'Fund the wallet with SOL (0.1+ SOL recommended for gas fees + trading)' },
      { text: 'Optional: add a custom RPC URL (Helius, QuickNode) in "API Secret" field for faster transactions', link: 'https://www.helius.dev/' },
    ],
    fields: ['apiKey'],
  },
};

// ---------------------------------------------------------------------------
// Add API Key Modal
// ---------------------------------------------------------------------------

function AddKeyModal({ onClose, onSuccess, preSelectedService }: { onClose: () => void; onSuccess: () => void; preSelectedService?: string }) {
  type ServiceType = 'coinbase' | 'alpaca' | 'robinhood' | 'polymarket' | 'solana';
  const [service, setService] = useState<ServiceType>(
    (preSelectedService as ServiceType) ?? 'coinbase'
  );
  const [keyName, setKeyName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [environment, setEnvironment] = useState<'production' | 'sandbox' | 'testnet'>('sandbox');
  const [error, setError] = useState('');
  const [showGuide, setShowGuide] = useState(true);

  const guide = EXCHANGE_SETUP_GUIDES[service];

  const addMutation = useMutation({
    mutationFn: (data: { service: string; keyName: string; apiKey: string; apiSecret?: string; passphrase?: string; environment: string }) =>
      apiClient.post('/settings/api-keys', data),
    onSuccess: () => {
      onSuccess();
      onClose();
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to add API key');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyName.trim() || !apiKey.trim()) {
      setError('Key name and API key are required');
      return;
    }
    setError('');
    addMutation.mutate({
      service,
      keyName: keyName.trim(),
      apiKey: apiKey.trim(),
      apiSecret: apiSecret.trim() || undefined,
      passphrase: passphrase.trim() || undefined,
      environment,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-slate-700/50 bg-slate-800 p-6 shadow-2xl">
        <h3 className="mb-4 text-lg font-semibold text-slate-100">Add Exchange API Key</h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Service */}
          <div>
            <label className="text-xs font-medium text-slate-400">Exchange</label>
            <select
              value={service}
              onChange={(e) => { setService(e.target.value as ServiceType); setShowGuide(true); }}
              className="input mt-1 w-full"
            >
              <option value="coinbase">Coinbase — Crypto Trading</option>
              <option value="alpaca">Alpaca — Stocks & ETFs</option>
              <option value="robinhood">Robinhood — Crypto Trading</option>
              <option value="polymarket">Polymarket — Prediction Markets</option>
              <option value="solana">Solana — Meme Coin Bot Wallet</option>
            </select>
          </div>

          {/* Setup Guide */}
          {guide && showGuide && (
            <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-400">
                  <Info className="h-3.5 w-3.5" />
                  How to get your {SERVICE_INFO[service]?.label} API keys
                </div>
                <button type="button" onClick={() => setShowGuide(false)} className="text-xs text-slate-500 hover:text-slate-300">
                  Hide
                </button>
              </div>
              <ol className="mt-2 space-y-1.5">
                {guide.steps.map((step, i) => (
                  <li key={i} className="flex gap-2 text-xs text-slate-300">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-[10px] font-bold text-blue-400">
                      {i + 1}
                    </span>
                    <span>
                      {step.text}
                      {step.link && (
                        <a
                          href={step.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-1 inline-flex items-center gap-0.5 text-blue-400 underline hover:text-blue-300"
                        >
                          Open <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {!showGuide && (
            <button type="button" onClick={() => setShowGuide(true)} className="text-xs text-blue-400 hover:text-blue-300">
              Show setup guide
            </button>
          )}

          {/* Key Name */}
          <div>
            <label className="text-xs font-medium text-slate-400">Key Name</label>
            <input
              type="text"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              placeholder={`e.g., My ${SERVICE_INFO[service]?.label ?? ''} Key`}
              className="input mt-1 w-full"
            />
          </div>

          {/* API Key */}
          <div>
            <label className="text-xs font-medium text-slate-400">
              {service === 'solana' ? 'Private Key (base58)' : 'API Key'}
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={service === 'coinbase' ? 'Key ID (UUID)' : service === 'solana' ? 'Base58 private key (88 chars)' : 'Paste your API key'}
              className="input mt-1 w-full font-mono text-sm"
            />
          </div>

          {/* Solana: Generate Wallet Button */}
          {service === 'solana' && !apiKey && (
            <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
              <button
                type="button"
                onClick={async () => {
                  try {
                    const { Keypair } = await import('@solana/web3.js');
                    const kp = Keypair.generate();
                    // Convert secret key to base58
                    const bs58Chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
                    let num = BigInt('0x' + Array.from(kp.secretKey).map(b => b.toString(16).padStart(2, '0')).join(''));
                    let b58 = '';
                    while (num > 0n) { b58 = bs58Chars[Number(num % 58n)] + b58; num = num / 58n; }
                    const pubKey = kp.publicKey.toBase58();
                    setApiKey(b58);
                    setKeyName(`Bot Wallet (${pubKey.slice(0, 8)}...)`);
                    setError('');
                    alert(`Wallet generated!\n\nPublic Key: ${pubKey}\n\nFund this address with SOL before trading.\nThe private key has been auto-filled below.`);
                  } catch (err) {
                    setError('Failed to generate wallet: ' + (err as Error).message);
                  }
                }}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-500"
              >
                <Sparkles className="h-4 w-4" />
                Generate New Bot Wallet
              </button>
              <div className="mt-2 flex items-start gap-1.5 text-[10px] text-slate-500">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
                <span>Creates a new Solana keypair in your browser. Fund it with SOL before trading. Never use your main wallet — use a dedicated bot wallet.</span>
              </div>
            </div>
          )}

          {/* API Secret */}
          <div>
            <label className="text-xs font-medium text-slate-400">
              API Secret
            </label>
            <input
              type="password"
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              placeholder="Paste your API secret"
              className="input mt-1 w-full font-mono text-sm"
            />
          </div>

          {/* Passphrase (Polymarket only) */}
          {service === 'polymarket' && (
            <div>
              <label className="text-xs font-medium text-slate-400">
                Passphrase
              </label>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Paste your CLOB passphrase"
                className="input mt-1 w-full font-mono text-sm"
              />
            </div>
          )}

          {/* Environment */}
          <div>
            <label className="text-xs font-medium text-slate-400">Environment</label>
            <select
              value={environment}
              onChange={(e) => setEnvironment(e.target.value as 'production' | 'sandbox' | 'testnet')}
              className="input mt-1 w-full"
            >
              <option value="sandbox">Sandbox (Paper Trading) — Recommended to start</option>
              <option value="testnet">Testnet</option>
              <option value="production">Production (Real Money)</option>
            </select>
          </div>

          {error && (
            <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost flex-1"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={addMutation.isPending}
              className="btn-primary flex flex-1 items-center justify-center gap-2"
            >
              {addMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Key className="h-4 w-4" />
              )}
              Add Key
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// API Key Card
// ---------------------------------------------------------------------------

function ApiKeyCard({ apiKey, onDeleted }: { apiKey: MaskedApiKey; onDeleted: () => void }) {
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
          {/* Test button */}
          <button
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
            className="btn-ghost p-2"
            title="Test connection"
          >
            {testMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
            ) : (
              <TestTube className="h-4 w-4 text-blue-400" />
            )}
          </button>

          {/* Delete button */}
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <button
                onClick={() => { deleteMutation.mutate(); setConfirmDelete(false); }}
                className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-500"
              >
                Confirm
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded bg-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-600"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={deleteMutation.isPending}
              className="btn-ghost p-2"
              title="Delete key"
            >
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

// ---------------------------------------------------------------------------
// Asset Protection Card
// ---------------------------------------------------------------------------

function AssetProtectionCard() {
  const queryClient = useQueryClient();

  const { data: protectionData, isLoading } = useQuery<{ data: AssetProtectionConfig }>({
    queryKey: ['asset-protection'],
    queryFn: () => apiClient.get<{ data: AssetProtectionConfig }>('/settings/asset-protection'),
    refetchInterval: 10000,
  });

  const config = protectionData?.data;

  const [budgetInput, setBudgetInput] = useState('');
  const [budgetSaved, setBudgetSaved] = useState(false);

  // Sync budget input from config
  useEffect(() => {
    if (config && budgetInput === '') {
      setBudgetInput(String(config.tradingBudgetUsd));
    }
  }, [config, budgetInput]);

  const updateMutation = useMutation({
    mutationFn: (data: Partial<AssetProtectionConfig>) =>
      apiClient.put('/settings/asset-protection', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-protection'] });
    },
  });

  const snapshotMutation = useMutation({
    mutationFn: () => apiClient.post('/settings/asset-protection/snapshot'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-protection'] });
    },
  });

  const toggleMasterSwitch = () => {
    if (!config) return;
    updateMutation.mutate({ engineTradingEnabled: !config.engineTradingEnabled });
  };

  const toggleAssetLock = (symbol: string, currentlyLocked: boolean) => {
    updateMutation.mutate({
      protectedAssets: { [symbol]: { locked: !currentlyLocked } } as unknown as Record<string, ProtectedAsset>,
    });
  };

  const lockAll = () => {
    if (!config) return;
    const updates: Record<string, ProtectedAsset> = {};
    for (const [symbol, asset] of Object.entries(config.protectedAssets)) {
      updates[symbol] = { ...asset, locked: true };
    }
    updateMutation.mutate({ protectedAssets: updates });
  };

  const saveBudget = () => {
    const val = parseFloat(budgetInput);
    if (isNaN(val) || val < 0) return;
    updateMutation.mutate({ tradingBudgetUsd: val });
    setBudgetSaved(true);
    setTimeout(() => setBudgetSaved(false), 2000);
  };

  const assets = config ? Object.values(config.protectedAssets) : [];
  const totalProtectedValue = assets.reduce((s, a) => s + a.snapshotValueUsd, 0);
  const lockedCount = assets.filter(a => a.locked).length;

  return (
    <div className="card lg:col-span-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-amber-400" />
          <div className="card-header">Asset Protection</div>
        </div>
        {config && (
          <div className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
            config.engineTradingEnabled
              ? 'bg-green-500/10 text-green-400'
              : 'bg-red-500/10 text-red-400'
          }`}>
            {config.engineTradingEnabled ? <ShieldOff className="h-3.5 w-3.5" /> : <Shield className="h-3.5 w-3.5" />}
            {config.engineTradingEnabled ? 'Live Trading ON' : 'Live Trading OFF'}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-amber-400" />
        </div>
      ) : !config ? (
        <div className="py-4 text-center text-sm text-slate-500">Failed to load protection config</div>
      ) : (
        <div className="space-y-4">
          {/* Master Switch */}
          <div className="flex items-center justify-between rounded-lg border border-slate-700/30 bg-slate-900/30 p-4">
            <div>
              <div className="text-sm font-medium text-slate-200">Engine Live Trading</div>
              <div className="mt-1 text-xs text-slate-500">
                Master switch. When OFF, the engine cannot place any real trades.
              </div>
            </div>
            <button
              onClick={toggleMasterSwitch}
              disabled={updateMutation.isPending}
              className={`relative inline-flex h-8 w-16 items-center rounded-full transition-colors ${
                config.engineTradingEnabled ? 'bg-green-600' : 'bg-slate-700'
              }`}
            >
              <span
                className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                  config.engineTradingEnabled ? 'translate-x-8' : 'translate-x-1.5'
                }`}
              />
            </button>
          </div>

          {/* Trading Budget */}
          <div className="rounded-lg border border-slate-700/30 bg-slate-900/30 p-4">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-green-400" />
              <div className="text-sm font-medium text-slate-200">Trading Budget</div>
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Max USD the engine can spend on new positions. Used: ${config.budgetUsedUsd.toFixed(2)}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-sm text-slate-400">$</span>
              <input
                type="number"
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                className="input w-32"
                min="0"
                step="50"
              />
              <button
                onClick={saveBudget}
                disabled={updateMutation.isPending}
                className="btn-primary flex items-center gap-1.5 text-sm"
              >
                {budgetSaved ? <CheckCircle className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
                {budgetSaved ? 'Saved' : 'Save'}
              </button>
            </div>
            {config.tradingBudgetUsd > 0 && (
              <div className="mt-2 h-2 w-full rounded-full bg-slate-700">
                <div
                  className="h-2 rounded-full bg-green-500 transition-all"
                  style={{ width: `${Math.min((config.budgetUsedUsd / config.tradingBudgetUsd) * 100, 100)}%` }}
                />
              </div>
            )}
          </div>

          {/* Snapshot + Protected Assets */}
          <div className="rounded-lg border border-slate-700/30 bg-slate-900/30 p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Camera className="h-4 w-4 text-blue-400" />
                  <div className="text-sm font-medium text-slate-200">Holdings Snapshot</div>
                </div>
                {config.snapshotTakenAt && (
                  <div className="mt-1 text-xs text-slate-500">
                    Last snapshot: {new Date(config.snapshotTakenAt).toLocaleString()} — {lockedCount}/{assets.length} locked, ${totalProtectedValue.toFixed(0)} protected
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={lockAll}
                  disabled={updateMutation.isPending || assets.length === 0}
                  className="btn-ghost flex items-center gap-1.5 text-xs"
                >
                  <Lock className="h-3.5 w-3.5 text-amber-400" />
                  Lock All
                </button>
                <button
                  onClick={() => snapshotMutation.mutate()}
                  disabled={snapshotMutation.isPending}
                  className="btn-primary flex items-center gap-1.5 text-sm"
                >
                  {snapshotMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Camera className="h-3.5 w-3.5" />
                  )}
                  Take Snapshot
                </button>
              </div>
            </div>

            {assets.length === 0 ? (
              <div className="mt-4 rounded-lg border border-dashed border-slate-700 bg-slate-900/20 py-6 text-center">
                <Shield className="mx-auto h-8 w-8 text-slate-600" />
                <p className="mt-2 text-sm text-slate-400">No holdings snapshot taken yet</p>
                <p className="mt-1 text-xs text-slate-500">
                  Click "Take Snapshot" to lock your current exchange holdings.
                </p>
              </div>
            ) : (
              <div className="mt-3 space-y-1.5">
                {assets.map((asset) => (
                  <div
                    key={asset.symbol}
                    className="flex items-center justify-between rounded-lg border border-slate-700/20 bg-slate-800/30 px-3 py-2"
                  >
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => toggleAssetLock(asset.symbol, asset.locked)}
                        disabled={updateMutation.isPending}
                        className={`rounded-full p-1 transition-colors ${
                          asset.locked
                            ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
                            : 'bg-slate-700/50 text-slate-500 hover:bg-slate-700'
                        }`}
                        title={asset.locked ? 'Protected — click to unlock' : 'Unlocked — click to lock'}
                      >
                        {asset.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                      </button>
                      <div>
                        <span className="text-sm font-semibold text-slate-200">{asset.symbol}</span>
                        <span className="ml-2 text-xs text-slate-500">{asset.snapshotQuantity} units</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium text-slate-300">
                        ${asset.snapshotValueUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <div className={`text-[10px] font-semibold ${asset.locked ? 'text-amber-400' : 'text-slate-500'}`}>
                        {asset.locked ? 'PROTECTED' : 'UNLOCKED'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Settings Page
// ---------------------------------------------------------------------------

export function SettingsPage() {
  const { paperTrading, setPaperTrading } = usePortfolioStore();
  const queryClient = useQueryClient();
  const [addModalService, setAddModalService] = useState<string | undefined>(undefined);

  // Auto-open modal if redirected with ?addKey=service
  const [showAddModal, setShowAddModal] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const addKey = params.get('addKey');
    if (addKey && ['coinbase', 'alpaca', 'polymarket'].includes(addKey)) {
      setAddModalService(addKey);
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
      return true;
    }
    return false;
  });
  const [riskSaved, setRiskSaved] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  // Risk limits form state
  const [riskPerTrade, setRiskPerTrade] = useState('1.0');
  const [dailyLossCap, setDailyLossCap] = useState('3.0');
  const [weeklyLossCap, setWeeklyLossCap] = useState('7.0');
  const [maxPortfolioHeat, setMaxPortfolioHeat] = useState('6.0');
  const [minRiskReward, setMinRiskReward] = useState('3.0');
  const [maxCorrelation, setMaxCorrelation] = useState('40');

  // Engine settings
  const [cycleInterval, setCycleInterval] = useState('600');
  const [notifyOnTrade, setNotifyOnTrade] = useState(true);
  const [notifyOnCircuitBreaker, setNotifyOnCircuitBreaker] = useState(true);
  const [notifyOnError, setNotifyOnError] = useState(true);
  const [notifyOnDailyReport, setNotifyOnDailyReport] = useState(false);

  // Fetch API keys
  const { data: apiKeysData, isLoading: keysLoading } = useQuery<ApiKeysResponse>({
    queryKey: ['api-keys'],
    queryFn: () => apiClient.get<ApiKeysResponse>('/settings/api-keys'),
    refetchInterval: 30000,
  });

  const apiKeys = apiKeysData?.data ?? [];

  // Fetch risk limits from backend
  const { data: riskData } = useQuery<{ data: RiskLimits }>({
    queryKey: ['risk-limits'],
    queryFn: () => apiClient.get<{ data: RiskLimits }>('/settings/risk-limits'),
  });

  // Fetch general settings from backend
  const { data: settingsData } = useQuery<{ data: Record<string, unknown> }>({
    queryKey: ['settings'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>('/settings'),
  });

  // Populate form from fetched risk limits
  useEffect(() => {
    if (riskData?.data) {
      const r = riskData.data;
      if (r.maxRiskPerTrade != null) setRiskPerTrade(String(r.maxRiskPerTrade));
      if (r.dailyLossCap != null) setDailyLossCap(String(r.dailyLossCap));
      if (r.weeklyLossCap != null) setWeeklyLossCap(String(r.weeklyLossCap));
      if (r.maxPortfolioHeat != null) setMaxPortfolioHeat(String(r.maxPortfolioHeat));
      if (r.minRiskReward != null) setMinRiskReward(String(r.minRiskReward));
      if (r.maxCorrelation != null) setMaxCorrelation(String(r.maxCorrelation));
    }
  }, [riskData]);

  // Populate general settings
  useEffect(() => {
    if (settingsData?.data) {
      const s = settingsData.data;
      const cycleVal = s.cycleInterval as { seconds?: number } | undefined;
      if (cycleVal?.seconds != null) setCycleInterval(String(cycleVal.seconds));
      const notif = s.notifications as { onTrade?: boolean; onCircuitBreaker?: boolean; onError?: boolean; onDailyReport?: boolean } | undefined;
      if (notif) {
        if (notif.onTrade != null) setNotifyOnTrade(notif.onTrade);
        if (notif.onCircuitBreaker != null) setNotifyOnCircuitBreaker(notif.onCircuitBreaker);
        if (notif.onError != null) setNotifyOnError(notif.onError);
        if (notif.onDailyReport != null) setNotifyOnDailyReport(notif.onDailyReport);
      }
      const paper = s.paperTrading as { enabled?: boolean } | undefined;
      if (paper?.enabled != null) setPaperTrading(paper.enabled);
    }
  }, [settingsData, setPaperTrading]);

  // Save risk limits mutation
  const saveRiskMutation = useMutation({
    mutationFn: (data: Record<string, number>) =>
      apiClient.put('/settings/risk-limits', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['risk-limits'] });
      setRiskSaved(true);
      setTimeout(() => setRiskSaved(false), 2000);
    },
  });

  // Save general settings mutation
  const saveSettingsMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiClient.put('/settings', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 2000);
    },
  });

  const invalidateKeys = () => {
    queryClient.invalidateQueries({ queryKey: ['api-keys'] });
  };

  const handleSaveRiskLimits = () => {
    saveRiskMutation.mutate({
      maxRiskPerTrade: parseFloat(riskPerTrade),
      dailyLossCap: parseFloat(dailyLossCap),
      weeklyLossCap: parseFloat(weeklyLossCap),
      maxPortfolioHeat: parseFloat(maxPortfolioHeat),
      minRiskReward: parseFloat(minRiskReward),
      maxCorrelation: parseFloat(maxCorrelation),
    });
  };

  const handleTogglePaperTrading = () => {
    const next = !paperTrading;
    setPaperTrading(next);
    saveSettingsMutation.mutate({ paperTrading: next });
  };

  const handleSaveCycleInterval = () => {
    saveSettingsMutation.mutate({ cycleIntervalSeconds: parseInt(cycleInterval, 10) });
  };

  const handleSaveNotifications = () => {
    saveSettingsMutation.mutate({
      notifications: {
        onTrade: notifyOnTrade,
        onCircuitBreaker: notifyOnCircuitBreaker,
        onError: notifyOnError,
        onDailyReport: notifyOnDailyReport,
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="h-6 w-6 text-blue-400" />
        <h1 className="text-2xl font-bold text-slate-100">Settings</h1>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Trading Mode */}
        <div className="card">
          <div className="card-header">Trading Mode</div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-slate-200">
                Paper / Live Toggle
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Paper mode simulates trades without real money. Switch to Live
                mode when ready for production.
              </div>
            </div>
            <button
              onClick={handleTogglePaperTrading}
              className={`relative inline-flex h-8 w-16 items-center rounded-full transition-colors ${
                paperTrading ? 'bg-amber-600' : 'bg-blue-600'
              }`}
            >
              <span
                className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                  paperTrading ? 'translate-x-1.5' : 'translate-x-8'
                }`}
              />
            </button>
          </div>
          <div
            className={`mt-3 rounded-lg px-3 py-2 text-sm font-medium ${
              paperTrading
                ? 'bg-amber-500/10 text-amber-400'
                : 'bg-blue-500/10 text-blue-400'
            }`}
          >
            Currently: {paperTrading ? 'PAPER TRADING' : 'LIVE TRADING'}
          </div>
        </div>

        {/* Engine Cycle Interval */}
        <div className="card">
          <div className="card-header">Engine Configuration</div>
          <div>
            <label className="text-sm font-medium text-slate-200">
              Cycle Interval (seconds)
            </label>
            <p className="mt-0.5 text-xs text-slate-500">
              How often the engine runs a full analysis + trade cycle.
            </p>
            <input
              type="number"
              value={cycleInterval}
              onChange={(e) => setCycleInterval(e.target.value)}
              className="input mt-2 w-full"
              min="60"
              max="3600"
              step="60"
            />
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-slate-500">
              Current: every {Math.floor(Number(cycleInterval) / 60)} minutes
            </span>
            <button
              onClick={handleSaveCycleInterval}
              disabled={saveSettingsMutation.isPending}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              {saveSettingsMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : settingsSaved ? (
                <CheckCircle className="h-3.5 w-3.5" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save
            </button>
          </div>
        </div>

        {/* Asset Protection */}
        <AssetProtectionCard />

        {/* Risk Limits */}
        <div className="card lg:col-span-2">
          <div className="card-header">Risk Limits</div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="text-xs font-medium text-slate-400">
                Max Risk per Trade (%)
              </label>
              <input
                type="number"
                value={riskPerTrade}
                onChange={(e) => setRiskPerTrade(e.target.value)}
                className="input mt-1 w-full"
                step="0.1"
                min="0.1"
                max="5"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400">
                Daily Loss Cap (%)
              </label>
              <input
                type="number"
                value={dailyLossCap}
                onChange={(e) => setDailyLossCap(e.target.value)}
                className="input mt-1 w-full"
                step="0.5"
                min="1"
                max="10"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400">
                Weekly Loss Cap (%)
              </label>
              <input
                type="number"
                value={weeklyLossCap}
                onChange={(e) => setWeeklyLossCap(e.target.value)}
                className="input mt-1 w-full"
                step="0.5"
                min="2"
                max="20"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400">
                Max Portfolio Heat (%)
              </label>
              <input
                type="number"
                value={maxPortfolioHeat}
                onChange={(e) => setMaxPortfolioHeat(e.target.value)}
                className="input mt-1 w-full"
                step="0.5"
                min="1"
                max="15"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400">
                Min Risk/Reward Ratio
              </label>
              <input
                type="number"
                value={minRiskReward}
                onChange={(e) => setMinRiskReward(e.target.value)}
                className="input mt-1 w-full"
                step="0.5"
                min="1"
                max="10"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400">
                Max Correlation Exposure (%)
              </label>
              <input
                type="number"
                value={maxCorrelation}
                onChange={(e) => setMaxCorrelation(e.target.value)}
                className="input mt-1 w-full"
                step="5"
                min="10"
                max="100"
              />
            </div>
          </div>
          <div className="mt-4">
            <button
              onClick={handleSaveRiskLimits}
              disabled={saveRiskMutation.isPending}
              className="btn-primary flex items-center gap-2"
            >
              {saveRiskMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : riskSaved ? (
                <CheckCircle className="h-4 w-4" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {riskSaved ? 'Saved!' : 'Save Risk Limits'}
            </button>
          </div>
        </div>

        {/* API Keys - REAL DATA */}
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
            {(['coinbase', 'alpaca', 'robinhood', 'polymarket', 'solana'] as const).map((svc) => {
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

          {keysLoading ? (
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

        {/* Notifications */}
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between">
            <div className="card-header">Notification Preferences</div>
            <button
              onClick={handleSaveNotifications}
              disabled={saveSettingsMutation.isPending}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              {saveSettingsMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save
            </button>
          </div>
          <div className="space-y-3">
            {[
              {
                label: 'Trade Executed',
                desc: 'Get notified when a trade is executed',
                checked: notifyOnTrade,
                onChange: setNotifyOnTrade,
              },
              {
                label: 'Circuit Breaker',
                desc: 'Alert when circuit breaker is triggered',
                checked: notifyOnCircuitBreaker,
                onChange: setNotifyOnCircuitBreaker,
              },
              {
                label: 'Errors',
                desc: 'Notify on agent or engine errors',
                checked: notifyOnError,
                onChange: setNotifyOnError,
              },
              {
                label: 'Daily Report',
                desc: 'Receive daily P&L summary',
                checked: notifyOnDailyReport,
                onChange: setNotifyOnDailyReport,
              },
            ].map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between rounded-lg border border-slate-700/30 bg-slate-900/30 p-3"
              >
                <div>
                  <div className="text-sm font-medium text-slate-200">
                    {item.label}
                  </div>
                  <div className="text-xs text-slate-500">{item.desc}</div>
                </div>
                <button
                  onClick={() => item.onChange(!item.checked)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    item.checked ? 'bg-blue-600' : 'bg-slate-700'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      item.checked ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Add Key Modal */}
      {showAddModal && (
        <AddKeyModal
          onClose={() => setShowAddModal(false)}
          onSuccess={invalidateKeys}
          preSelectedService={addModalService}
        />
      )}
    </div>
  );
}
