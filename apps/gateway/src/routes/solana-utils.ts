import { Connection, Keypair, PublicKey, Transaction, clusterApiUrl } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createCloseAccountInstruction,
  createBurnInstruction,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { decryptApiKey } from '@tradeworks/db';
import { getMemoryKeysByService } from './api-keys.js';

// ── RPC Rate Limiter ─────────────────────────────────────────────────

/**
 * Token bucket rate limiter for Solana RPC calls.
 * Prevents 429 errors by capping outgoing requests.
 */
export class RpcRateLimiter {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly refillRate: number;
  private lastRefill: number;
  private readonly queue: Array<{ resolve: () => void }> = [];
  private drainTimer: ReturnType<typeof setInterval> | null = null;

  constructor(maxTokens: number, refillRatePerSecond: number) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillRate = refillRatePerSecond;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push({ resolve });
      this.ensureDraining();
    });
  }

  private ensureDraining(): void {
    if (this.drainTimer) return;
    this.drainTimer = setInterval(() => {
      this.refill();
      while (this.queue.length > 0 && this.tokens >= 1) {
        this.tokens -= 1;
        this.queue.shift()!.resolve();
      }
      if (this.queue.length === 0 && this.drainTimer) {
        clearInterval(this.drainTimer);
        this.drainTimer = null;
      }
    }, 100);
  }
}

/** Global Helius RPC rate limiter: 8 req/sec (safe margin on 10 RPS free tier) */
export const heliusLimiter = new RpcRateLimiter(8, 8);

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

// Lazy getters — dotenv hasn't run yet when this module is first imported
function getDefaultRpcUrl(): string {
  return process.env.SOLANA_RPC_URL ?? clusterApiUrl('mainnet-beta');
}

function getSecondaryRpcUrl(): string {
  return process.env.SOLANA_SECONDARY_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
}

/** Secondary Solana connection for non-critical calls (mint validation, safety checks) */
export function getSecondaryConnection(
  commitment: 'processed' | 'confirmed' | 'finalized' = 'confirmed',
): Connection {
  return new Connection(getSecondaryRpcUrl(), { commitment });
}

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
  let rpcUrl = getDefaultRpcUrl();

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
  return getDefaultRpcUrl();
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

// ── RPC Retry ──────────────────────────────────────────────────────────

/**
 * Retry wrapper for Solana RPC calls with exponential backoff.
 * Catches transient HTTP 429 (rate limit) and network errors.
 */
export async function withRpcRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  baseDelayMs = 1000,
): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    await heliusLimiter.acquire();
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) throw err;
      const is429 = err instanceof Error && (
        err.message.includes('429') || err.message.includes('rate limit') || err.message.includes('Too many requests')
      );
      const jitter = Math.random() * 500;
      const delay = is429
        ? baseDelayMs * Math.pow(2, attempt) + jitter
        : baseDelayMs + jitter;
      console.warn(
        `[Solana] RPC attempt ${attempt + 1}/${retries + 1} failed${is429 ? ' (429)' : ''}, retrying in ${Math.round(delay)}ms:`,
        err instanceof Error ? err.message : String(err),
      );
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('withRpcRetry: unreachable');
}

// ── Balance Check ──────────────────────────────────────────────────────

/** Fee overhead buffer: priority fees + rent for ATA creation + tx fees. */
const FEE_OVERHEAD_LAMPORTS = 5_000_000; // 0.005 SOL

/**
 * Check if the wallet has enough SOL for a swap.
 * Accounts for priority fees, ATA rent, and transaction fees.
 */
export async function hasEnoughSolForSwap(amountLamports: number): Promise<{
  sufficient: boolean;
  balanceLamports: number;
  requiredLamports: number;
}> {
  const requiredLamports = amountLamports + FEE_OVERHEAD_LAMPORTS;
  try {
    const keypair = getSolanaKeypair();
    const connection = getSolanaConnection();
    const balanceLamports = await connection.getBalance(keypair.publicKey);
    return {
      sufficient: balanceLamports >= requiredLamports,
      balanceLamports,
      requiredLamports,
    };
  } catch {
    return { sufficient: false, balanceLamports: 0, requiredLamports };
  }
}

// ── Token Account Utilities ─────────────────────────────────────────

/** Rent reserved per SPL token account (2,039,280 lamports ≈ 0.00204 SOL) */
const TOKEN_ACCOUNT_RENT_LAMPORTS = 2_039_280;

export interface TokenAccountInfo {
  /** On-chain token account address */
  pubkey: string;
  /** Mint address of the token */
  mint: string;
  /** Current token balance (UI amount) */
  balance: number;
  /** Decimal places for the token */
  decimals: number;
  /** Which token program owns this account (standard vs Token-2022) */
  programId: string;
}

/**
 * Fetch ALL SPL token accounts for the bot wallet, including 0-balance accounts.
 * Queries both TOKEN_PROGRAM_ID and TOKEN_2022_PROGRAM_ID.
 */
export async function getAllTokenAccounts(): Promise<TokenAccountInfo[]> {
  const keypair = getSolanaKeypair();
  const connection = getSolanaConnection();
  const accounts: TokenAccountInfo[] = [];

  // Fetch sequentially to avoid overwhelming public RPC rate limits
  const standardAccounts = await withRpcRetry(
    () => connection.getParsedTokenAccountsByOwner(keypair.publicKey, {
      programId: TOKEN_PROGRAM_ID,
    }),
    5,   // more retries for this heavy call
    2000, // longer base delay
  );

  // Brief pause between heavy RPC calls
  await new Promise(resolve => setTimeout(resolve, 2000));

  const token2022Accounts = await withRpcRetry(
    () => connection.getParsedTokenAccountsByOwner(keypair.publicKey, {
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    5,
    2000,
  ).catch(() => ({ value: [] as typeof standardAccounts.value }));

  for (const { pubkey, account } of standardAccounts.value) {
    const parsed = account.data.parsed?.info as Record<string, unknown> | undefined;
    if (!parsed) continue;
    const tokenAmount = parsed.tokenAmount as { uiAmount: number; decimals: number } | undefined;
    accounts.push({
      pubkey: pubkey.toBase58(),
      mint: parsed.mint as string,
      balance: tokenAmount?.uiAmount ?? 0,
      decimals: tokenAmount?.decimals ?? 0,
      programId: TOKEN_PROGRAM_ID.toBase58(),
    });
  }

  for (const { pubkey, account } of token2022Accounts.value) {
    const parsed = account.data.parsed?.info as Record<string, unknown> | undefined;
    if (!parsed) continue;
    const tokenAmount = parsed.tokenAmount as { uiAmount: number; decimals: number } | undefined;
    accounts.push({
      pubkey: pubkey.toBase58(),
      mint: parsed.mint as string,
      balance: tokenAmount?.uiAmount ?? 0,
      decimals: tokenAmount?.decimals ?? 0,
      programId: TOKEN_2022_PROGRAM_ID.toBase58(),
    });
  }

  return accounts;
}

/**
 * Close a single SPL token account and recover its rent (~0.00204 SOL).
 * Works with both standard Token program and Token-2022.
 *
 * @param tokenAccountPubkey  The on-chain token account address to close
 * @param programIdStr        The token program that owns this account
 * @returns Result with signature and approximate rent recovered
 */
export async function closeTokenAccount(
  tokenAccountPubkey: string,
  programIdStr?: string,
): Promise<{ success: boolean; signature?: string; rentRecoveredLamports: number }> {
  try {
    const keypair = getSolanaKeypair();
    const connection = getSolanaConnection();

    const accountPubkey = new PublicKey(tokenAccountPubkey);
    const programId = programIdStr
      ? new PublicKey(programIdStr)
      : TOKEN_PROGRAM_ID;

    const instruction = createCloseAccountInstruction(
      accountPubkey,         // account to close
      keypair.publicKey,     // destination (receive rent)
      keypair.publicKey,     // authority (owner)
      [],                    // no multisig signers
      programId,             // token program
    );

    const transaction = new Transaction().add(instruction);

    const { blockhash, lastValidBlockHeight } = await withRpcRetry(
      () => connection.getLatestBlockhash('confirmed'),
    );
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = keypair.publicKey;
    transaction.sign(keypair);

    const signature = await withRpcRetry(
      () => connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      }),
      2,
    );

    await connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    }, 'confirmed');

    return {
      success: true,
      signature,
      rentRecoveredLamports: TOKEN_ACCOUNT_RENT_LAMPORTS,
    };
  } catch (err) {
    console.error(
      `[Solana] Failed to close token account ${tokenAccountPubkey.slice(0, 8)}...:`,
      err instanceof Error ? err.message : err,
    );
    return { success: false, rentRecoveredLamports: 0 };
  }
}

/**
 * Batch-close multiple empty token accounts to recover rent.
 * Packs up to 20 close instructions per transaction for efficiency.
 *
 * @param accounts Array of token account infos to close (should have balance === 0)
 * @returns Summary of results
 */
export async function batchCloseTokenAccounts(
  accounts: TokenAccountInfo[],
): Promise<{
  closed: number;
  failed: number;
  totalRentRecoveredLamports: number;
  signatures: string[];
}> {
  const keypair = getSolanaKeypair();
  const connection = getSolanaConnection();

  let closed = 0;
  let failed = 0;
  let totalRentRecoveredLamports = 0;
  const signatures: string[] = [];

  // Process in batches of 20 (Solana tx size limit ~1232 bytes, close instruction is small)
  const BATCH_SIZE = 20;

  for (let batchStart = 0; batchStart < accounts.length; batchStart += BATCH_SIZE) {
    const batch = accounts.slice(batchStart, batchStart + BATCH_SIZE);

    try {
      const transaction = new Transaction();

      for (const account of batch) {
        const programId = new PublicKey(account.programId);
        const instruction = createCloseAccountInstruction(
          new PublicKey(account.pubkey),
          keypair.publicKey,
          keypair.publicKey,
          [],
          programId,
        );
        transaction.add(instruction);
      }

      const { blockhash, lastValidBlockHeight } = await withRpcRetry(
        () => connection.getLatestBlockhash('confirmed'),
      );
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = keypair.publicKey;
      transaction.sign(keypair);

      const signature = await withRpcRetry(
        () => connection.sendRawTransaction(transaction.serialize(), {
          skipPreflight: false,
          maxRetries: 3,
        }),
        2,
      );

      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      }, 'confirmed');

      closed += batch.length;
      totalRentRecoveredLamports += batch.length * TOKEN_ACCOUNT_RENT_LAMPORTS;
      signatures.push(signature);

      console.log(
        `[Solana] Batch closed ${batch.length} token accounts, recovered ~${(batch.length * TOKEN_ACCOUNT_RENT_LAMPORTS / 1e9).toFixed(4)} SOL (tx: ${signature.slice(0, 12)}...)`,
      );
    } catch (err) {
      console.error(
        `[Solana] Batch close failed for ${batch.length} accounts:`,
        err instanceof Error ? err.message : err,
      );
      // Fall back to individual closes for this batch
      for (const account of batch) {
        const result = await closeTokenAccount(account.pubkey, account.programId);
        if (result.success) {
          closed++;
          totalRentRecoveredLamports += result.rentRecoveredLamports;
          if (result.signature) signatures.push(result.signature);
        } else {
          failed++;
        }
      }
    }

    // Small delay between batches to respect rate limits
    if (batchStart + BATCH_SIZE < accounts.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  return { closed, failed, totalRentRecoveredLamports, signatures };
}

/**
 * Burn all tokens in an account and then close it to recover rent.
 * This is for dead/unsellable tokens where selling is impossible.
 * Burns the entire token balance, then closes the empty account.
 *
 * @param account  Token account info (must have balance > 0)
 * @returns Result with success, signature, and rent recovered
 */
export async function burnAndCloseTokenAccount(
  account: TokenAccountInfo,
): Promise<{ success: boolean; signature?: string; rentRecoveredLamports: number; tokensBurned: number }> {
  try {
    const keypair = getSolanaKeypair();
    const connection = getSolanaConnection();

    const accountPubkey = new PublicKey(account.pubkey);
    const mintPubkey = new PublicKey(account.mint);
    const programId = new PublicKey(account.programId);

    // Calculate raw amount from UI amount and decimals
    const rawAmount = BigInt(Math.floor(account.balance * Math.pow(10, account.decimals)));

    const transaction = new Transaction();

    // Step 1: Burn all tokens
    if (rawAmount > 0n) {
      transaction.add(
        createBurnInstruction(
          accountPubkey,       // token account
          mintPubkey,          // mint
          keypair.publicKey,   // owner/authority
          rawAmount,           // amount to burn (all of them)
          [],                  // no multisig signers
          programId,           // token program
        ),
      );
    }

    // Step 2: Close the now-empty account
    transaction.add(
      createCloseAccountInstruction(
        accountPubkey,         // account to close
        keypair.publicKey,     // destination (receive rent)
        keypair.publicKey,     // authority
        [],                    // no multisig signers
        programId,             // token program
      ),
    );

    const { blockhash, lastValidBlockHeight } = await withRpcRetry(
      () => connection.getLatestBlockhash('confirmed'),
    );
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = keypair.publicKey;
    transaction.sign(keypair);

    const signature = await withRpcRetry(
      () => connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      }),
      2,
    );

    await connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    }, 'confirmed');

    return {
      success: true,
      signature,
      rentRecoveredLamports: TOKEN_ACCOUNT_RENT_LAMPORTS,
      tokensBurned: account.balance,
    };
  } catch (err) {
    console.error(
      `[Solana] Failed to burn+close ${account.mint.slice(0, 8)}...:`,
      err instanceof Error ? err.message : err,
    );
    return { success: false, rentRecoveredLamports: 0, tokensBurned: 0 };
  }
}

/**
 * Batch burn-and-close multiple token accounts with non-zero balances.
 * Packs up to 10 burn+close pairs per transaction (each pair = 2 instructions).
 *
 * @param accounts Array of token accounts to burn and close
 * @returns Summary of results
 */
export async function batchBurnAndCloseTokenAccounts(
  accounts: TokenAccountInfo[],
): Promise<{
  closed: number;
  failed: number;
  totalRentRecoveredLamports: number;
  totalTokensBurned: number;
  signatures: string[];
}> {
  const keypair = getSolanaKeypair();
  const connection = getSolanaConnection();

  let closed = 0;
  let failed = 0;
  let totalRentRecoveredLamports = 0;
  let totalTokensBurned = 0;
  const signatures: string[] = [];

  // 10 burn+close pairs = 20 instructions per tx (near Solana limit)
  const BATCH_SIZE = 10;

  for (let batchStart = 0; batchStart < accounts.length; batchStart += BATCH_SIZE) {
    const batch = accounts.slice(batchStart, batchStart + BATCH_SIZE);

    try {
      const transaction = new Transaction();

      for (const account of batch) {
        const accountPubkey = new PublicKey(account.pubkey);
        const mintPubkey = new PublicKey(account.mint);
        const programId = new PublicKey(account.programId);
        const rawAmount = BigInt(Math.floor(account.balance * Math.pow(10, account.decimals)));

        // Burn instruction
        if (rawAmount > 0n) {
          transaction.add(
            createBurnInstruction(accountPubkey, mintPubkey, keypair.publicKey, rawAmount, [], programId),
          );
        }

        // Close instruction
        transaction.add(
          createCloseAccountInstruction(accountPubkey, keypair.publicKey, keypair.publicKey, [], programId),
        );
      }

      const { blockhash, lastValidBlockHeight } = await withRpcRetry(
        () => connection.getLatestBlockhash('confirmed'),
      );
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = keypair.publicKey;
      transaction.sign(keypair);

      const signature = await withRpcRetry(
        () => connection.sendRawTransaction(transaction.serialize(), {
          skipPreflight: false,
          maxRetries: 3,
        }),
        2,
      );

      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');

      closed += batch.length;
      totalRentRecoveredLamports += batch.length * TOKEN_ACCOUNT_RENT_LAMPORTS;
      totalTokensBurned += batch.reduce((sum, a) => sum + a.balance, 0);
      signatures.push(signature);

      console.log(
        `[Solana] Batch burned+closed ${batch.length} accounts, recovered ~${(batch.length * TOKEN_ACCOUNT_RENT_LAMPORTS / 1e9).toFixed(4)} SOL (tx: ${signature.slice(0, 12)}...)`,
      );
    } catch (err) {
      console.error(
        `[Solana] Batch burn+close failed for ${batch.length} accounts:`,
        err instanceof Error ? err.message : err,
      );
      // Fall back to individual burn+close for this batch
      for (const account of batch) {
        const result = await burnAndCloseTokenAccount(account);
        if (result.success) {
          closed++;
          totalRentRecoveredLamports += result.rentRecoveredLamports;
          totalTokensBurned += result.tokensBurned;
          if (result.signature) signatures.push(result.signature);
        } else {
          failed++;
        }
      }
    }

    // Delay between batches to respect rate limits
    if (batchStart + BATCH_SIZE < accounts.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return { closed, failed, totalRentRecoveredLamports, totalTokensBurned, signatures };
}
