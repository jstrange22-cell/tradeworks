/**
 * EVM Wallet Provider — WalletConnect + MetaMask + SafePal
 *
 * Enables multi-chain wallet connection for the Crypto Agent.
 * SafePal connects via WalletConnect protocol.
 * Session persists across page reloads via localStorage.
 */

import { createWeb3Modal, defaultWagmiConfig } from '@web3modal/wagmi/react';
import { WagmiProvider, createStorage } from 'wagmi';
import { mainnet, base, bsc, polygon, arbitrum } from 'wagmi/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// WalletConnect project ID (get from cloud.walletconnect.com)
const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? 'demo-project-id';

const metadata = {
  name: 'TradeWorks',
  description: 'AI Trading Platform',
  url: 'https://ai.pulsiq.ai',
  icons: ['https://ai.pulsiq.ai/favicon.ico'],
};

const chains = [mainnet, base, bsc, polygon, arbitrum] as const;

const wagmiConfig = defaultWagmiConfig({
  chains,
  projectId,
  metadata,
  enableWalletConnect: true,
  enableCoinbase: true,
  enableInjected: true,
  storage: createStorage({ storage: typeof window !== 'undefined' ? window.localStorage : undefined }),
});

createWeb3Modal({
  wagmiConfig,
  projectId,
  enableAnalytics: false,
  themeMode: 'dark',
});

const queryClient = new QueryClient();

export function EVMWalletProvider({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig} reconnectOnMount>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
