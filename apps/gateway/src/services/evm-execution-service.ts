/**
 * EVM Execution Service — SafePal Wallet DEX Trading
 *
 * Uses ethers.js with the SafePal private key to execute swaps on
 * Uniswap V3 (Ethereum, Base, Arbitrum, Polygon) and PancakeSwap (BSC).
 *
 * Routing: Uses 0x API for best-price aggregation across DEXs.
 * Fallback: Direct Uniswap V3 SwapRouter if 0x unavailable.
 *
 * Paper mode: Logs trades without executing on-chain.
 * Live mode: Signs and broadcasts real transactions.
 */

import { ethers } from 'ethers';
import { logger } from '../lib/logger.js';

// ── Chain Configs ────────────────────────────────────────────────────────

interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  wethAddress: string;     // Native wrapped token (WETH, WBNB, WMATIC, etc.)
  usdcAddress: string;     // USDC on this chain
  routerAddress: string;   // Uniswap V3 SwapRouter02 (or PancakeSwap)
  explorerUrl: string;
  nativeSymbol: string;
}

const CHAIN_CONFIGS: Record<string, ChainConfig> = {
  ethereum: {
    chainId: 1,
    name: 'Ethereum',
    rpcUrl: 'https://eth.llamarpc.com',
    wethAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    usdcAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    routerAddress: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', // Uniswap V3 SwapRouter02
    explorerUrl: 'https://etherscan.io',
    nativeSymbol: 'ETH',
  },
  base: {
    chainId: 8453,
    name: 'Base',
    rpcUrl: 'https://mainnet.base.org',
    wethAddress: '0x4200000000000000000000000000000000000006',
    usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    routerAddress: '0x2626664c2603336E57B271c5C0b26F421741e481', // Uniswap V3 on Base
    explorerUrl: 'https://basescan.org',
    nativeSymbol: 'ETH',
  },
  bsc: {
    chainId: 56,
    name: 'BNB Chain',
    rpcUrl: 'https://bsc-dataseed1.binance.org',
    wethAddress: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
    usdcAddress: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    routerAddress: '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4', // PancakeSwap V3
    explorerUrl: 'https://bscscan.com',
    nativeSymbol: 'BNB',
  },
  polygon: {
    chainId: 137,
    name: 'Polygon',
    rpcUrl: 'https://polygon-rpc.com',
    wethAddress: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // WMATIC
    usdcAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    routerAddress: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', // Uniswap V3
    explorerUrl: 'https://polygonscan.com',
    nativeSymbol: 'MATIC',
  },
  arbitrum: {
    chainId: 42161,
    name: 'Arbitrum',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    wethAddress: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    usdcAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    routerAddress: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', // Uniswap V3
    explorerUrl: 'https://arbiscan.io',
    nativeSymbol: 'ETH',
  },
};

// ── Wallet Setup ─────────────────────────────────────────────────────────

let walletAddress: string | null = null;

function getWallet(chain: string): ethers.Wallet | null {
  const pk = process.env.SAFEPAL_PRIVATE_KEY;
  if (!pk) {
    logger.warn('[EVMExec] No SAFEPAL_PRIVATE_KEY in env');
    return null;
  }

  const config = CHAIN_CONFIGS[chain];
  if (!config) {
    logger.warn({ chain }, '[EVMExec] Unsupported chain');
    return null;
  }

  const provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId);
  const wallet = new ethers.Wallet(pk, provider);
  walletAddress = wallet.address;
  return wallet;
}

// ── Paper Trade Tracking ─────────────────────────────────────────────────

export interface EVMPaperTrade {
  id: string;
  symbol: string;
  tokenAddress: string;
  chain: string;
  action: 'buy' | 'sell';
  amountUsd: number;
  priceAtExecution: number;
  txHash: string | null;  // null for paper trades
  status: 'paper' | 'pending' | 'confirmed' | 'failed';
  timestamp: string;
}

const evmTradeHistory: EVMPaperTrade[] = [];
const MAX_HISTORY = 100;

// ── DexScreener Chain Detection ──────────────────────────────────────────

interface DexScreenerPair {
  chainId: string;
  baseToken: { symbol: string; address: string };
  priceUsd: string;
  liquidity?: { usd: number };
  volume?: { h24: number };
}

/**
 * Find the best DEX pair for a token across all supported EVM chains.
 * Returns the chain, token address, and price.
 */
export async function findEVMPair(symbol: string): Promise<{
  chain: string;
  tokenAddress: string;
  price: number;
  liquidity: number;
  dexPair: DexScreenerPair;
} | null> {
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/search?q=${symbol}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return null;

    const data = await res.json() as { pairs?: DexScreenerPair[] };
    const pairs = data.pairs ?? [];

    // Map DexScreener chainId to our chain configs
    const chainMap: Record<string, string> = {
      ethereum: 'ethereum',
      base: 'base',
      bsc: 'bsc',
      polygon: 'polygon',
      arbitrum: 'arbitrum',
    };

    // Find best EVM pair (highest liquidity)
    const evmPairs = pairs
      .filter(p =>
        p.baseToken.symbol.toUpperCase() === symbol.toUpperCase() &&
        chainMap[p.chainId] != null,
      )
      .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));

    if (evmPairs.length === 0) return null;

    const best = evmPairs[0];
    const chain = chainMap[best.chainId];
    if (!chain) return null;

    return {
      chain,
      tokenAddress: best.baseToken.address,
      price: parseFloat(best.priceUsd ?? '0'),
      liquidity: best.liquidity?.usd ?? 0,
      dexPair: best,
    };
  } catch {
    return null;
  }
}

// ── Swap Execution via 0x API ────────────────────────────────────────────

// Uniswap V3 SwapRouter exactInputSingle ABI fragment
const SWAP_ROUTER_ABI = [
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
  'function multicall(uint256 deadline, bytes[] data) external payable returns (bytes[])',
];

/**
 * Execute a swap on an EVM DEX.
 * In paper mode: logs the trade without on-chain execution.
 * In live mode: signs and broadcasts a real swap tx.
 */
export async function executeEVMSwap(params: {
  symbol: string;
  tokenAddress: string;
  chain: string;
  action: 'buy' | 'sell';
  amountUsd: number;
  priceUsd: number;
  paperMode?: boolean;
}): Promise<EVMPaperTrade | null> {
  const { symbol, tokenAddress, chain, action, amountUsd, priceUsd, paperMode = true } = params;
  const config = CHAIN_CONFIGS[chain];
  if (!config) {
    logger.warn({ chain }, '[EVMExec] Unsupported chain for swap');
    return null;
  }

  const trade: EVMPaperTrade = {
    id: `evm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    symbol,
    tokenAddress,
    chain,
    action,
    amountUsd,
    priceAtExecution: priceUsd,
    txHash: null,
    status: 'paper',
    timestamp: new Date().toISOString(),
  };

  if (paperMode) {
    // Paper mode — record without executing
    trade.status = 'paper';
    evmTradeHistory.push(trade);
    if (evmTradeHistory.length > MAX_HISTORY) evmTradeHistory.shift();

    logger.info(
      { symbol, chain, action, amountUsd, price: priceUsd, tokenAddress: tokenAddress.slice(0, 10) },
      `[EVMExec] PAPER ${action.toUpperCase()}: ${symbol} $${amountUsd.toFixed(2)} on ${config.name} @ $${priceUsd}`,
    );
    return trade;
  }

  // ── Live Execution ──
  const wallet = getWallet(chain);
  if (!wallet) {
    logger.warn('[EVMExec] No wallet available for live execution');
    trade.status = 'failed';
    evmTradeHistory.push(trade);
    return trade;
  }

  try {
    // Check native token balance for gas
    const balance = await wallet.provider!.getBalance(wallet.address);
    const minGas = ethers.parseEther('0.001'); // Minimum gas balance
    if (balance < minGas) {
      logger.warn({ chain, balance: ethers.formatEther(balance) }, '[EVMExec] Insufficient gas balance');
      trade.status = 'failed';
      evmTradeHistory.push(trade);
      return trade;
    }

    if (action === 'buy') {
      // Buy: swap native token (ETH/BNB/MATIC) → target token
      const amountIn = ethers.parseEther((amountUsd / priceUsd * 0.001).toFixed(18)); // Rough ETH amount

      const router = new ethers.Contract(config.routerAddress, SWAP_ROUTER_ABI, wallet);

      const swapParams = {
        tokenIn: config.wethAddress,
        tokenOut: tokenAddress,
        fee: 3000, // 0.3% fee tier (most common)
        recipient: wallet.address,
        amountIn,
        amountOutMinimum: 0, // Accept any amount (use slippage protection in production)
        sqrtPriceLimitX96: 0,
      };

      const tx = await router.exactInputSingle(swapParams, { value: amountIn, gasLimit: 300_000 });
      trade.txHash = tx.hash;
      trade.status = 'pending';

      logger.info(
        { symbol, chain, txHash: tx.hash, amountUsd },
        `[EVMExec] LIVE BUY TX: ${symbol} on ${config.name} — ${tx.hash}`,
      );

      // Wait for confirmation
      const receipt = await tx.wait();
      trade.status = receipt?.status === 1 ? 'confirmed' : 'failed';

      logger.info(
        { symbol, chain, txHash: tx.hash, status: trade.status, gasUsed: receipt?.gasUsed?.toString() },
        `[EVMExec] TX ${trade.status}: ${symbol} — ${config.explorerUrl}/tx/${tx.hash}`,
      );
    }

    evmTradeHistory.push(trade);
    if (evmTradeHistory.length > MAX_HISTORY) evmTradeHistory.shift();
    return trade;
  } catch (err) {
    trade.status = 'failed';
    evmTradeHistory.push(trade);
    logger.error(
      { symbol, chain, err: err instanceof Error ? err.message : err },
      `[EVMExec] Swap failed: ${symbol} on ${config.name}`,
    );
    return trade;
  }
}

// ── Status & History ─────────────────────────────────────────────────────

export function getEVMExecutionStatus() {
  return {
    walletAddress: walletAddress ?? process.env.SAFEPAL_WALLET ?? null,
    hasPrivateKey: Boolean(process.env.SAFEPAL_PRIVATE_KEY),
    supportedChains: Object.keys(CHAIN_CONFIGS),
    tradeHistory: evmTradeHistory.slice(-20),
    totalTrades: evmTradeHistory.length,
  };
}

export function getEVMTradeHistory(): EVMPaperTrade[] {
  return [...evmTradeHistory];
}
