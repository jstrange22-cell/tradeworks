import { Connection, Keypair, clusterApiUrl } from '@solana/web3.js';
import bs58 from 'bs58';
import { decryptApiKey } from '@tradeworks/db';
import { getMemoryKeysByService } from './api-keys.js';

/**
 * Solana wallet utilities.
 *
 * Provides helpers to retrieve the bot wallet keypair, a reusable
 * Connection instance, and wallet status checks.  Uses the same
 * encrypted key storage as Coinbase/Alpaca keys.
 *
 * Key format in storage:
 *   encryptedKey    = base58-encoded private key (encrypted)
 *   encryptedSecret = RPC URL override (optional, encrypted)
 */

// ── Default RPC ──────────────────────────────────────────────────────────

const DEFAULT_RPC_URL = process.env.SOLANA_RPC_URL
  ?? clusterApiUrl('mainnet-beta');

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Get the raw Solana key record from storage. Returns null if no key is stored.
 */
function getSolanaKeyRecord() {
  const keys = getMemoryKeysByService('solana');
  if (keys.length === 0) return null;
  return keys[0];
}

/**
 * Decrypt the stored private key and return a Solana Keypair.
 * Throws if no Solana key is stored or decryption fails.
 */
export function getSolanaKeypair(): Keypair {
  const record = getSolanaKeyRecord();
  if (!record) {
    throw new Error('No Solana wallet configured. Add one in Settings → API Keys.');
  }

  const base58Key = decryptApiKey(record.encryptedKey as Buffer);
  const secretKey = bs58.decode(base58Key);

  if (secretKey.length !== 64) {
    throw new Error(`Invalid Solana private key: expected 64 bytes, got ${secretKey.length}`);
  }

  return Keypair.fromSecretKey(secretKey);
}

/**
 * Get a Solana Connection instance.
 * Uses the stored RPC URL override if one exists, otherwise the default.
 */
export function getSolanaConnection(
  commitment: 'processed' | 'confirmed' | 'finalized' = 'confirmed',
): Connection {
  let rpcUrl = DEFAULT_RPC_URL;

  const record = getSolanaKeyRecord();
  if (record?.encryptedSecret) {
    try {
      const customRpc = decryptApiKey(record.encryptedSecret as Buffer);
      if (customRpc && customRpc.startsWith('http')) {
        rpcUrl = customRpc;
      }
    } catch {
      // Ignore — use default RPC
    }
  }

  return new Connection(rpcUrl, { commitment });
}

/**
 * Get the bot wallet public key as a base58 string.
 */
export function getSolanaWalletAddress(): string {
  return getSolanaKeypair().publicKey.toBase58();
}

/**
 * Check whether a Solana bot wallet is configured.
 */
export function isSolanaConnected(): boolean {
  return getSolanaKeyRecord() !== null;
}

/**
 * Get Solana RPC URL (for display / diagnostics).
 */
export function getSolanaRpcUrl(): string {
  const record = getSolanaKeyRecord();
  if (record?.encryptedSecret) {
    try {
      const customRpc = decryptApiKey(record.encryptedSecret as Buffer);
      if (customRpc && customRpc.startsWith('http')) {
        return customRpc;
      }
    } catch { /* use default */ }
  }
  return DEFAULT_RPC_URL;
}

/**
 * Validate a base58 private key string.
 * Returns true if it decodes to a valid 64-byte Solana keypair.
 */
export function isValidSolanaPrivateKey(base58Key: string): boolean {
  try {
    const decoded = bs58.decode(base58Key);
    if (decoded.length !== 64) return false;
    Keypair.fromSecretKey(decoded);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get public key from a base58-encoded private key (for validation/display).
 */
export function publicKeyFromPrivateKey(base58Key: string): string {
  const decoded = bs58.decode(base58Key);
  const keypair = Keypair.fromSecretKey(decoded);
  return keypair.publicKey.toBase58();
}
