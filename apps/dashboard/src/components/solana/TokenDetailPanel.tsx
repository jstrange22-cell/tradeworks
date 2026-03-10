import { ExternalLink, AlertTriangle, Shield } from 'lucide-react';
import { formatCompact, SafetyCheck } from '@/components/solana/shared';
import type { TokenInfo, TokenSafety } from '@/types/solana';

export function TokenDetailPanel({ detail, onClose }: {
  detail: { token: TokenInfo | null; safety: TokenSafety };
  onClose: () => void;
}) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-200">
          {detail.token?.symbol ?? 'Token'} -- Safety Analysis
        </h2>
        <button onClick={onClose} className="text-xs text-slate-500 hover:text-slate-300">Close</button>
      </div>
      {detail.token && (
        <div className="grid grid-cols-2 gap-3 mb-4 text-xs lg:grid-cols-4">
          <div>
            <span className="text-slate-400">Price:</span>{' '}
            <span className="text-slate-200 font-mono">
              ${detail.token.priceUsd < 0.01 ? detail.token.priceUsd.toExponential(2) : detail.token.priceUsd.toFixed(6)}
            </span>
          </div>
          <div>
            <span className="text-slate-400">Volume 24h:</span>{' '}
            <span className="text-slate-200 font-mono">${formatCompact(detail.token.volume24h)}</span>
          </div>
          <div>
            <span className="text-slate-400">Liquidity:</span>{' '}
            <span className="text-slate-200 font-mono">${formatCompact(detail.token.liquidity)}</span>
          </div>
          <div>
            <span className="text-slate-400">Market Cap:</span>{' '}
            <span className="text-slate-200 font-mono">${formatCompact(detail.token.marketCap)}</span>
          </div>
        </div>
      )}
      <div className="space-y-2">
        <span className={`text-xs font-bold px-2 py-0.5 rounded ${
          detail.safety.riskLevel === 'low' ? 'bg-green-500/20 text-green-400'
            : detail.safety.riskLevel === 'medium' ? 'bg-yellow-500/20 text-yellow-400'
            : detail.safety.riskLevel === 'high' ? 'bg-orange-500/20 text-orange-400'
            : 'bg-red-500/20 text-red-400'
        }`}>
          Risk: {detail.safety.riskLevel.toUpperCase()}
        </span>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 text-xs">
          <SafetyCheck label="Mint Authority" passed={detail.safety.mintAuthorityRevoked} passText="Revoked" failText="NOT Revoked" />
          <SafetyCheck label="Freeze Authority" passed={detail.safety.freezeAuthorityRevoked} passText="Revoked" failText="NOT Revoked" />
          <div className="flex items-center gap-2 rounded-lg border border-slate-700/50 bg-slate-900/50 p-2">
            <Shield className="h-4 w-4 text-slate-400" />
            <span className="text-slate-400">Top 10:</span>
            <span className="text-slate-200 font-mono">
              {detail.safety.top10HolderPercent !== null ? `${detail.safety.top10HolderPercent.toFixed(1)}%` : 'N/A'}
            </span>
          </div>
        </div>
        {detail.safety.warnings.length > 0 && (
          <div className="mt-2 space-y-1">
            {detail.safety.warnings.map((warning, index) => (
              <div key={index} className="flex items-start gap-1.5 text-xs text-yellow-400">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />{warning}
              </div>
            ))}
          </div>
        )}
        {detail.token?.url && (
          <a
            href={detail.token.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 mt-2"
          >
            View on Dexscreener <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}
