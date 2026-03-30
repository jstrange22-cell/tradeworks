import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { useState, useEffect } from 'react';

interface TokenHolding {
  mint: string;
  amount: number;
  valueUsd: number;
}

interface PhantomBalanceResult {
  solBalance: number | null;
  totalValueUsd: number | null;
  tokens: TokenHolding[];
  loading: boolean;
  connected: boolean;
  publicKey: ReturnType<typeof useWallet>['publicKey'];
}

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

export function usePhantomBalance(): PhantomBalanceResult {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [totalValueUsd, setTotalValueUsd] = useState<number | null>(null);
  const [tokens, setTokens] = useState<TokenHolding[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!connected || !publicKey) {
      setSolBalance(null);
      setTotalValueUsd(null);
      setTokens([]);
      return;
    }

    let cancelled = false;

    const fetchBalance = async () => {
      setLoading(true);
      try {
        const lamports = await connection.getBalance(publicKey);
        const sol = lamports / 1e9;
        if (cancelled) return;
        setSolBalance(sol);

        // SOL price via Jupiter
        let solPrice = 130;
        try {
          const res = await fetch('https://api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112', {
            signal: AbortSignal.timeout(5000),
          });
          if (res.ok) {
            const data = (await res.json()) as { data?: Record<string, { price?: string }> };
            const p = data.data?.['So11111111111111111111111111111111111111112']?.price;
            if (p) solPrice = parseFloat(p);
          }
        } catch { /* fallback */ }

        const solValueUsd = sol * solPrice;

        // Fetch all SPL tokens
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
          programId: TOKEN_PROGRAM_ID,
        });

        const holdings: TokenHolding[] = [];
        const mints: string[] = [];

        for (const account of tokenAccounts.value) {
          const info = (account.account.data as { parsed: { info: { mint: string; tokenAmount: { uiAmount: number } } } }).parsed.info;
          if (info.tokenAmount.uiAmount > 0) {
            holdings.push({ mint: info.mint, amount: info.tokenAmount.uiAmount, valueUsd: 0 });
            mints.push(info.mint);
          }
        }

        // Batch price lookup
        if (mints.length > 0) {
          try {
            const res = await fetch(`https://api.jup.ag/price/v2?ids=${mints.join(',')}`, {
              signal: AbortSignal.timeout(8000),
            });
            if (res.ok) {
              const data = (await res.json()) as { data: Record<string, { price?: string }> };
              for (const h of holdings) {
                const price = parseFloat(data.data[h.mint]?.price ?? '0');
                h.valueUsd = h.amount * price;
              }
            }
          } catch { /* prices stay 0 */ }
        }

        if (cancelled) return;
        const tokenValue = holdings.reduce((s, h) => s + h.valueUsd, 0);
        setTokens(holdings);
        setTotalValueUsd(solValueUsd + tokenValue);
      } catch {
        if (!cancelled) { setSolBalance(null); setTotalValueUsd(null); setTokens([]); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchBalance();
    const interval = setInterval(fetchBalance, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [connection, publicKey, connected]);

  return { solBalance, totalValueUsd, tokens, loading, connected, publicKey };
}
