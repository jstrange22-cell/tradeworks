import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useState, useEffect } from 'react';

interface PhantomBalanceResult {
  balance: number | null;
  loading: boolean;
  connected: boolean;
  publicKey: ReturnType<typeof useWallet>['publicKey'];
}

export function usePhantomBalance(): PhantomBalanceResult {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!connected || !publicKey) {
      setBalance(null);
      return;
    }

    let cancelled = false;

    const fetchBalance = async () => {
      setLoading(true);
      try {
        const lamports = await connection.getBalance(publicKey);
        if (!cancelled) setBalance(lamports / 1e9);
      } catch {
        if (!cancelled) setBalance(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchBalance();
    const interval = setInterval(fetchBalance, 30_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [connection, publicKey, connected]);

  return { balance, loading, connected, publicKey };
}
