import { useState } from 'react';
import { Wallet, Copy, Check, Zap, ArrowDownToLine, Bot, ShieldCheck } from 'lucide-react';

interface BotWalletGuideProps {
  botWallet: string | null | undefined;
  botConnected: boolean;
  solBalance: string;
  solValueUsd: string;
}

export function BotWalletGuide({ botWallet, botConnected, solBalance, solValueUsd }: BotWalletGuideProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!botWallet) return;
    try {
      await navigator.clipboard.writeText(botWallet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      // clipboard API may be unavailable
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700/50 dark:bg-slate-800/50">
      {/* SOL Balance Hero */}
      <div className="mb-5 flex items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-500/10">
          <Zap className="h-6 w-6 text-purple-600 dark:text-purple-400" />
        </div>
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-slate-400">Bot Wallet SOL Balance</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-slate-100">{solBalance}</p>
          {solValueUsd && (
            <p className="text-xs text-gray-500 dark:text-slate-500">{solValueUsd}</p>
          )}
        </div>
      </div>

      {/* Wallet Address */}
      {botConnected && botWallet ? (
        <div className="mb-5 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-slate-600/50 dark:bg-slate-900/50">
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-slate-500">
            Bot Wallet Address
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate font-mono text-xs text-gray-800 dark:text-slate-300">
              {botWallet}
            </code>
            <button
              onClick={handleCopy}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-500 transition hover:bg-gray-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
              title="Copy address"
            >
              {copied
                ? <Check className="h-3.5 w-3.5 text-green-500" />
                : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      ) : (
        <div className="mb-5 rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-xs text-yellow-800 dark:border-yellow-500/30 dark:bg-yellow-500/10 dark:text-yellow-300">
          Bot wallet is not connected. Start the gateway server to connect.
        </div>
      )}

      {/* Guide Steps */}
      <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-slate-200">
        How the Bot Wallet Works
      </h3>
      <div className="space-y-3">
        <GuideStep
          icon={<Wallet className="h-4 w-4" />}
          title="Dedicated Trading Wallet"
          description="The bot wallet is a server-side Solana keypair used exclusively by the sniper engine. It operates independently from your Phantom browser wallet."
        />
        <GuideStep
          icon={<ArrowDownToLine className="h-4 w-4" />}
          title="Fund Your Bot"
          description="Send SOL from Phantom (or any wallet/exchange) to the bot wallet address above. The bot needs SOL to execute snipe trades and pay transaction fees."
        />
        <GuideStep
          icon={<Bot className="h-4 w-4" />}
          title="Automated Trading"
          description="When the sniper engine detects a qualifying token, it uses the bot wallet to execute buy orders automatically based on your configured parameters."
        />
        <GuideStep
          icon={<ShieldCheck className="h-4 w-4" />}
          title="Isolated Risk"
          description="Only the SOL in this wallet is at risk. Your Phantom wallet and exchange accounts remain untouched. Fund only what you are willing to lose."
        />
      </div>
    </div>
  );
}

function GuideStep({ icon, title, description }: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
        {icon}
      </div>
      <div>
        <p className="text-xs font-medium text-gray-800 dark:text-slate-200">{title}</p>
        <p className="text-[11px] leading-relaxed text-gray-500 dark:text-slate-400">{description}</p>
      </div>
    </div>
  );
}
