import { formatCompact } from '@/components/solana/shared';
import type { TokenInfo, SolanaTokenBalance } from '@/types/solana';

// ─── TokenTable ─────────────────────────────────────────────────────────

export function TokenTable({ tokens, onSelect, onBuy }: {
  tokens: TokenInfo[];
  onSelect: (mint: string) => void;
  onBuy: (mint: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-slate-700/50 text-slate-400">
            <th className="pb-2 pr-4">Token</th>
            <th className="pb-2 pr-4 text-right">Price</th>
            <th className="pb-2 pr-4 text-right">24h %</th>
            <th className="pb-2 pr-4 text-right">Volume</th>
            <th className="pb-2 pr-4 text-right">Liquidity</th>
            <th className="pb-2 pr-4 text-right">Market Cap</th>
            <th className="pb-2"></th>
          </tr>
        </thead>
        <tbody>
          {tokens.map((token) => (
            <tr
              key={token.mint}
              className="border-b border-slate-700/30 hover:bg-slate-700/20 cursor-pointer"
              onClick={() => onSelect(token.mint)}
            >
              <td className="py-2 pr-4">
                <div className="font-medium text-slate-200">{token.symbol}</div>
                <div className="text-[10px] text-slate-500">{token.name.slice(0, 20)}</div>
              </td>
              <td className="py-2 pr-4 text-right font-mono text-slate-200">
                ${token.priceUsd < 0.01 ? token.priceUsd.toExponential(2) : token.priceUsd.toFixed(4)}
              </td>
              <td className={`py-2 pr-4 text-right font-mono ${token.priceChange24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {token.priceChange24h >= 0 ? '+' : ''}{token.priceChange24h.toFixed(1)}%
              </td>
              <td className="py-2 pr-4 text-right font-mono text-slate-300">${formatCompact(token.volume24h)}</td>
              <td className="py-2 pr-4 text-right font-mono text-slate-300">${formatCompact(token.liquidity)}</td>
              <td className="py-2 pr-4 text-right font-mono text-slate-300">${formatCompact(token.marketCap)}</td>
              <td className="py-2 text-right">
                <button
                  onClick={(event) => { event.stopPropagation(); onBuy(token.mint); }}
                  className="rounded bg-blue-600/20 px-2 py-0.5 text-[10px] font-medium text-blue-400 hover:bg-blue-600/30"
                >
                  Buy
                </button>
              </td>
            </tr>
          ))}
          {tokens.length === 0 && (
            <tr><td colSpan={7} className="py-8 text-center text-slate-500">No tokens found</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── WalletTokenTable ───────────────────────────────────────────────────

export function WalletTokenTable({ tokens }: { tokens: SolanaTokenBalance[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-slate-700/50 text-slate-400">
            <th className="pb-2 pr-4">Token</th>
            <th className="pb-2 pr-4 text-right">Amount</th>
            <th className="pb-2 pr-4 text-right">Value</th>
            <th className="pb-2 text-right">Mint</th>
          </tr>
        </thead>
        <tbody>
          {tokens.map((token) => (
            <tr key={token.mint} className="border-b border-slate-700/30">
              <td className="py-2 pr-4 font-medium text-slate-200">{token.symbol}</td>
              <td className="py-2 pr-4 text-right font-mono text-slate-300">{token.amount.toFixed(4)}</td>
              <td className="py-2 pr-4 text-right font-mono text-slate-300">${token.valueUsd.toFixed(2)}</td>
              <td className="py-2 text-right font-mono text-slate-500 text-[10px]">
                {token.mint.slice(0, 8)}...{token.mint.slice(-4)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
