import { Router, type Router as RouterType } from 'express';
import { VersionedTransaction } from '@solana/web3.js';
import {
  isSolanaConnected,
  getSolanaKeypair,
  getSolanaConnection,
} from './solana-utils.js';

/**
 * Solana swap endpoints (via Jupiter V6 aggregator).
 *
 * GET  /api/v1/solana/quote              — Get swap quote
 * POST /api/v1/solana/swap               — Execute swap (bot wallet)
 * GET  /api/v1/solana/swap/:signature    — Check transaction status
 */

export const solanaSwapRouter: RouterType = Router();

// ── Constants ──────────────────────────────────────────────────────────

const JUPITER_QUOTE_URL = 'https://quote-api.jup.ag/v6/quote';
const JUPITER_SWAP_URL = 'https://quote-api.jup.ag/v6/swap';

// ── GET /quote — Get swap quote ────────────────────────────────────────

solanaSwapRouter.get('/quote', async (req, res) => {
  try {
    const {
      inputMint,
      outputMint,
      amount,
      slippageBps = '300',
    } = req.query as Record<string, string>;

    if (!inputMint || !outputMint || !amount) {
      res.status(400).json({
        error: 'Missing required params: inputMint, outputMint, amount',
      });
      return;
    }

    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount,
      slippageBps,
    });

    const response = await fetch(`${JUPITER_QUOTE_URL}?${params}`);

    if (!response.ok) {
      const errText = await response.text();
      res.status(response.status).json({
        error: 'Jupiter quote failed',
        message: errText,
      });
      return;
    }

    const quote = await response.json();

    res.json({
      data: quote,
      message: 'Quote fetched successfully',
    });
  } catch (err) {
    console.error('[Solana] Quote failed:', err);
    res.status(500).json({
      error: 'Failed to get swap quote',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// ── POST /swap — Execute swap via bot wallet ───────────────────────────

solanaSwapRouter.post('/swap', async (req, res) => {
  if (!isSolanaConnected()) {
    res.status(400).json({
      error: 'No Solana wallet configured',
      message: 'Add a Solana bot wallet in Settings → API Keys',
    });
    return;
  }

  try {
    const {
      inputMint,
      outputMint,
      amount,
      slippageBps = 300,
      priorityFee = 50000, // micro-lamports per CU, default ~moderate
    } = req.body as {
      inputMint: string;
      outputMint: string;
      amount: string;
      slippageBps?: number;
      priorityFee?: number;
    };

    if (!inputMint || !outputMint || !amount) {
      res.status(400).json({
        error: 'Missing required fields: inputMint, outputMint, amount',
      });
      return;
    }

    const keypair = getSolanaKeypair();
    const connection = getSolanaConnection();

    // Step 1: Get quote
    const quoteParams = new URLSearchParams({
      inputMint,
      outputMint,
      amount,
      slippageBps: String(slippageBps),
    });

    const quoteRes = await fetch(`${JUPITER_QUOTE_URL}?${quoteParams}`);
    if (!quoteRes.ok) {
      const errText = await quoteRes.text();
      res.status(400).json({ error: 'Quote failed', message: errText });
      return;
    }

    const quoteResponse = await quoteRes.json();

    // Step 2: Get swap transaction
    const swapRes = await fetch(JUPITER_SWAP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey: keypair.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: priorityFee,
      }),
    });

    if (!swapRes.ok) {
      const errText = await swapRes.text();
      res.status(400).json({ error: 'Swap transaction build failed', message: errText });
      return;
    }

    const swapData = (await swapRes.json()) as { swapTransaction: string };
    const swapTransactionBuf = Buffer.from(swapData.swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);

    // Step 3: Sign and send
    transaction.sign([keypair]);

    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: true,
      maxRetries: 3,
    });

    // Step 4: Confirm (wait up to 30s)
    const latestBlockhash = await connection.getLatestBlockhash();
    const confirmation = await connection.confirmTransaction({
      signature,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    }, 'confirmed');

    const success = !confirmation.value.err;

    res.json({
      data: {
        signature,
        success,
        inputMint,
        outputMint,
        inputAmount: amount,
        outputAmount: (quoteResponse as { outAmount?: string }).outAmount ?? null,
        priceImpactPct: (quoteResponse as { priceImpactPct?: string }).priceImpactPct ?? null,
        error: confirmation.value.err ? String(confirmation.value.err) : null,
      },
      message: success ? 'Swap executed successfully' : 'Swap transaction failed on-chain',
    });
  } catch (err) {
    console.error('[Solana] Swap failed:', err);
    res.status(500).json({
      error: 'Swap execution failed',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// ── GET /swap/:signature — Check transaction status ────────────────────

solanaSwapRouter.get('/swap/:signature', async (req, res) => {
  try {
    const { signature } = req.params;
    const connection = getSolanaConnection();

    const status = await connection.getSignatureStatus(signature as string, {
      searchTransactionHistory: true,
    });

    if (!status.value) {
      res.json({
        data: {
          signature,
          status: 'not_found',
          confirmations: null,
          err: null,
        },
      });
      return;
    }

    res.json({
      data: {
        signature,
        status: status.value.confirmationStatus ?? 'unknown',
        confirmations: status.value.confirmations,
        err: status.value.err ? String(status.value.err) : null,
        slot: status.value.slot,
      },
    });
  } catch (err) {
    console.error('[Solana] Status check failed:', err);
    res.status(500).json({
      error: 'Failed to check transaction status',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});
