/**
 * Smart Money Tracker — Phase 5: On-Chain Analytics
 *
 * Tracks wallets that consistently profit on meme coins.
 * Cross-references recent token transactions against a curated
 * smart money list to boost signal confidence.
 *
 * Data sources:
 *   - Helius RPC (getSignaturesForAddress) — free with API key
 *   - In-memory wallet list persisted to .sniper-data/smart-money.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { getSolanaConnection, withRpcRetry } from '../../routes/solana-utils.js';
import { PublicKey } from '@solana/web3.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface SmartMoneyWallet {
  address: string;
  winRate: number;       // 0-1
  totalTrades: number;
  totalPnlSol: number;
  lastActive: number;    // timestamp ms
  trackedSince: number;  // timestamp ms
}

export interface SmartMoneyActivity {
  smartBuyers: number;
  totalSmartWallets: number;
  confidence: number; // 0-100 boost, each smart buyer = +10, capped at 30
}

// ── Persistence ────────────────────────────────────────────────────────

const DATA_DIR = path.join(process.cwd(), '.sniper-data');
const PERSIST_FILE = path.join(DATA_DIR, 'smart-money.json');

const smartMoneyWallets: Map<string, SmartMoneyWallet> = new Map();

function ensureDir(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch { /* ignore */ }
}

function loadFromDisk(): void {
  try {
    if (!fs.existsSync(PERSIST_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(PERSIST_FILE, 'utf-8')) as SmartMoneyWallet[];
    if (!Array.isArray(raw)) return;
    for (const wallet of raw) {
      if (wallet.address) {
        smartMoneyWallets.set(wallet.address, wallet);
      }
    }
    console.log(`[SmartMoney] Loaded ${smartMoneyWallets.size} wallets from disk`);
  } catch (err) {
    console.warn('[SmartMoney] Failed to load persisted data:', err instanceof Error ? err.message : err);
  }
}

function saveToDisk(): void {
  ensureDir();
  try {
    const data = [...smartMoneyWallets.values()];
    fs.writeFileSync(PERSIST_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[SmartMoney] Failed to persist data:', err instanceof Error ? err.message : err);
  }
}

// Load on module init
loadFromDisk();

// ── Public API ─────────────────────────────────────────────────────────

export function addSmartMoneyWallet(
  address: string,
  stats: { winRate: number; totalTrades: number; totalPnlSol: number },
): void {
  const existing = smartMoneyWallets.get(address);
  const now = Date.now();

  smartMoneyWallets.set(address, {
    address,
    winRate: stats.winRate,
    totalTrades: stats.totalTrades,
    totalPnlSol: stats.totalPnlSol,
    lastActive: existing?.lastActive ?? now,
    trackedSince: existing?.trackedSince ?? now,
  });

  saveToDisk();
  console.log(`[SmartMoney] Added/updated wallet ${address.slice(0, 8)}... (WR: ${(stats.winRate * 100).toFixed(0)}%, trades: ${stats.totalTrades})`);
}

export function removeSmartMoneyWallet(address: string): void {
  if (smartMoneyWallets.delete(address)) {
    saveToDisk();
    console.log(`[SmartMoney] Removed wallet ${address.slice(0, 8)}...`);
  }
}

export function getSmartMoneyWallets(): SmartMoneyWallet[] {
  return [...smartMoneyWallets.values()];
}

/**
 * Check if any smart money wallets have recently interacted with a token.
 *
 * Fetches recent transaction signatures for the mint address via Helius RPC,
 * parses the first 20 to get signer addresses, and cross-references against
 * the smart money wallet list.
 */
export async function checkSmartMoneyActivity(mint: string): Promise<SmartMoneyActivity> {
  const totalSmartWallets = smartMoneyWallets.size;

  if (totalSmartWallets === 0) {
    return { smartBuyers: 0, totalSmartWallets: 0, confidence: 0 };
  }

  try {
    const connection = getSolanaConnection();
    const mintPubkey = new PublicKey(mint);

    // Fetch recent signatures for this token mint (limit 20 for speed)
    const signatures = await withRpcRetry(
      () => connection.getSignaturesForAddress(mintPubkey, { limit: 20 }, 'confirmed'),
      2,
      1500,
    );

    if (signatures.length === 0) {
      return { smartBuyers: 0, totalSmartWallets, confidence: 0 };
    }

    // Collect unique signer addresses from recent transactions
    const signerAddresses = new Set<string>();
    const txBatch = signatures.slice(0, 10); // Parse up to 10 for speed

    for (const sig of txBatch) {
      try {
        const tx = await withRpcRetry(
          () => connection.getParsedTransaction(sig.signature, {
            maxSupportedTransactionVersion: 0,
          }),
          1,
          1000,
        );

        if (!tx?.transaction?.message?.accountKeys) continue;

        for (const account of tx.transaction.message.accountKeys) {
          const addr = typeof account === 'string'
            ? account
            : (account as { pubkey: PublicKey }).pubkey.toBase58();
          signerAddresses.add(addr);
        }
      } catch {
        // Skip individual tx parse failures
      }
    }

    // Cross-reference against smart money list
    let smartBuyers = 0;
    for (const addr of signerAddresses) {
      if (smartMoneyWallets.has(addr)) {
        smartBuyers++;
        // Update last active timestamp
        const wallet = smartMoneyWallets.get(addr)!;
        wallet.lastActive = Date.now();
      }
    }

    // Each smart money buyer adds +10 confidence, capped at 30
    const confidence = Math.min(smartBuyers * 10, 30);

    if (smartBuyers > 0) {
      console.log(`[SmartMoney] ${mint.slice(0, 8)}...: ${smartBuyers} smart money wallets active (confidence +${confidence})`);
      saveToDisk(); // Persist lastActive updates
    }

    return { smartBuyers, totalSmartWallets, confidence };
  } catch (err) {
    console.warn('[SmartMoney] Activity check failed:', err instanceof Error ? err.message : err);
    return { smartBuyers: 0, totalSmartWallets, confidence: 0 };
  }
}

/**
 * Quick check: is any smart money wallet buying this token?
 * Convenience wrapper around checkSmartMoneyActivity.
 */
export async function isSmartMoneyBuying(mint: string): Promise<boolean> {
  const result = await checkSmartMoneyActivity(mint);
  return result.smartBuyers > 0;
}
