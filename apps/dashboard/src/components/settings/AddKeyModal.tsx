import { useState } from 'react';
import { Loader2, Key, Sparkles, AlertTriangle } from 'lucide-react';
import { useAddApiKeyMutation } from '@/hooks/useApiKeys';
import { SERVICE_INFO, type ServiceType } from '@/types/settings';
import { ExchangeSetupGuide } from '@/components/settings/ExchangeSetupGuide';

export function AddKeyModal({ onClose, onSuccess, preSelectedService }: {
  onClose: () => void; onSuccess: () => void; preSelectedService?: string;
}) {
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

  const addMutation = useAddApiKeyMutation({
    onSuccess: () => { onSuccess(); onClose(); },
    onError: (err) => { setError(err.message || 'Failed to add API key'); },
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

  const handleGenerateWallet = async () => {
    try {
      const { Keypair } = await import('@solana/web3.js');
      const kp = Keypair.generate();
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
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-slate-700/50 bg-slate-800 p-6 shadow-2xl">
        <h3 className="mb-4 text-lg font-semibold text-slate-100">Add Exchange API Key</h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-400">Exchange</label>
            <select value={service} onChange={(e) => { setService(e.target.value as ServiceType); setShowGuide(true); }}
              className="input mt-1 w-full">
              <option value="coinbase">Coinbase {'\u2014'} Crypto Trading</option>
              <option value="alpaca">Alpaca {'\u2014'} Stocks & ETFs</option>
              <option value="robinhood">Robinhood {'\u2014'} Crypto Trading</option>
              <option value="polymarket">Polymarket {'\u2014'} Prediction Markets</option>
              <option value="solana">Solana {'\u2014'} Meme Coin Bot Wallet</option>
            </select>
          </div>

          <ExchangeSetupGuide
            service={service}
            visible={showGuide}
            onHide={() => setShowGuide(false)}
            onShow={() => setShowGuide(true)}
          />

          <div>
            <label className="text-xs font-medium text-slate-400">Key Name</label>
            <input type="text" value={keyName} onChange={(e) => setKeyName(e.target.value)}
              placeholder={`e.g., My ${SERVICE_INFO[service]?.label ?? ''} Key`} className="input mt-1 w-full" />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-400">{service === 'solana' ? 'Private Key (base58)' : 'API Key'}</label>
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
              placeholder={service === 'coinbase' ? 'Key ID (UUID)' : service === 'solana' ? 'Base58 private key (88 chars)' : 'Paste your API key'}
              className="input mt-1 w-full font-mono text-sm" />
          </div>

          {service === 'solana' && !apiKey && (
            <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
              <button type="button" onClick={handleGenerateWallet}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-500">
                <Sparkles className="h-4 w-4" /> Generate New Bot Wallet
              </button>
              <div className="mt-2 flex items-start gap-1.5 text-[10px] text-slate-500">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
                <span>Creates a new Solana keypair in your browser. Fund it with SOL before trading. Never use your main wallet {'\u2014'} use a dedicated bot wallet.</span>
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-slate-400">API Secret</label>
            <input type="password" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)}
              placeholder="Paste your API secret" className="input mt-1 w-full font-mono text-sm" />
          </div>

          {service === 'polymarket' && (
            <div>
              <label className="text-xs font-medium text-slate-400">Passphrase</label>
              <input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Paste your CLOB passphrase" className="input mt-1 w-full font-mono text-sm" />
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-slate-400">Environment</label>
            <select value={environment} onChange={(e) => setEnvironment(e.target.value as 'production' | 'sandbox' | 'testnet')}
              className="input mt-1 w-full">
              <option value="sandbox">Sandbox (Paper Trading) {'\u2014'} Recommended to start</option>
              <option value="testnet">Testnet</option>
              <option value="production">Production (Real Money)</option>
            </select>
          </div>

          {error && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</div>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost flex-1">Cancel</button>
            <button type="submit" disabled={addMutation.isPending}
              className="btn-primary flex flex-1 items-center justify-center gap-2">
              {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Key className="h-4 w-4" />}
              Add Key
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
