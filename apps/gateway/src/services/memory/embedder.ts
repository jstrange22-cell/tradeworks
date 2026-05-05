/**
 * Provider-agnostic embedding shim.
 *
 * Drives an embedding provider via the `EMBEDDINGS_PROVIDER` env var:
 *   - `none`   (default) → deterministic zero-vector. Useful offline / dev.
 *   - `voyage` → Voyage AI `voyage-3-large` REST. Requires VOYAGE_API_KEY.
 *   - `openai` → OpenAI `text-embedding-3-small` (1536 dims) or `-3-large`
 *                (3072 dims, truncated to 1536 to match the schema column).
 *                Requires OPENAI_API_KEY.
 *
 * Always returns a vector of length EMBEDDING_DIMENSIONS (1536). If the
 * provider returns more, we truncate; if fewer, we right-pad with zeros and
 * log a warning. Provider failures fall back to a zero-vector + warn — they
 * MUST NOT crash the reasoner.
 *
 * In-process LRU cache keyed by sha256(text) keeps duplicate calls cheap.
 */

import { createHash } from 'crypto';
import { logger } from '../../lib/logger.js';

export const EMBEDDING_DIMENSIONS = 1536;

type ProviderId = 'none' | 'voyage' | 'openai';

function resolveProvider(): ProviderId {
  const raw = (process.env['EMBEDDINGS_PROVIDER'] ?? 'none').toLowerCase();
  if (raw === 'voyage' || raw === 'openai' || raw === 'none') return raw;
  logger.warn(
    { provider: raw },
    '[memory.embedder] unknown EMBEDDINGS_PROVIDER, defaulting to "none"',
  );
  return 'none';
}

const PROVIDER: ProviderId = resolveProvider();

// `EMBEDDING_PROVIDER` is the string written into decision_embeddings.provider
// so downstream queries can tell which generator produced a row.
export const EMBEDDING_PROVIDER: string = (() => {
  if (PROVIDER === 'voyage') {
    return process.env['VOYAGE_EMBED_MODEL'] ?? 'voyage-3-large';
  }
  if (PROVIDER === 'openai') {
    return process.env['OPENAI_EMBED_MODEL'] ?? 'text-embedding-3-small';
  }
  return 'stub';
})();

// ── tiny LRU cache (Map preserves insertion order) ──────────────────────
const CACHE_CAP = 1000;
const cache = new Map<string, number[]>();

function cacheKey(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function cacheGet(key: string): number[] | undefined {
  const v = cache.get(key);
  if (!v) return undefined;
  // Refresh recency by re-inserting.
  cache.delete(key);
  cache.set(key, v);
  return v;
}

function cacheSet(key: string, v: number[]): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, v);
  if (cache.size > CACHE_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

// ── shape helpers ──────────────────────────────────────────────────────
function zeroVector(): number[] {
  return new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
}

function conformShape(v: number[], providerLabel: string): number[] {
  if (v.length === EMBEDDING_DIMENSIONS) return v;
  if (v.length > EMBEDDING_DIMENSIONS) {
    logger.warn(
      { provider: providerLabel, gotDim: v.length, expectedDim: EMBEDDING_DIMENSIONS },
      '[memory.embedder] provider returned >1536 dims; truncating',
    );
    return v.slice(0, EMBEDDING_DIMENSIONS);
  }
  logger.warn(
    { provider: providerLabel, gotDim: v.length, expectedDim: EMBEDDING_DIMENSIONS },
    '[memory.embedder] provider returned <1536 dims; right-padding with zeros',
  );
  const padded = v.slice();
  while (padded.length < EMBEDDING_DIMENSIONS) padded.push(0);
  return padded;
}

// ── Voyage AI ───────────────────────────────────────────────────────────
async function embedViaVoyage(text: string): Promise<number[]> {
  const apiKey = process.env['VOYAGE_API_KEY'];
  if (!apiKey) {
    logger.warn('[memory.embedder] VOYAGE_API_KEY missing; returning zero-vector');
    return zeroVector();
  }
  const model = process.env['VOYAGE_EMBED_MODEL'] ?? 'voyage-3-large';

  const resp = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [text],
      input_type: 'document',
      // voyage-3-large supports `output_dimension` to request 1024/1536/2048/2-large defaults
      output_dimension: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`voyage embeddings ${resp.status}: ${body.slice(0, 200)}`);
  }
  const json = (await resp.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };
  const vec = json.data?.[0]?.embedding;
  if (!Array.isArray(vec)) throw new Error('voyage response missing data[0].embedding');
  return conformShape(vec, 'voyage');
}

// ── OpenAI ──────────────────────────────────────────────────────────────
async function embedViaOpenAI(text: string): Promise<number[]> {
  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) {
    logger.warn('[memory.embedder] OPENAI_API_KEY missing; returning zero-vector');
    return zeroVector();
  }
  // Default to small (1536 dim, exact match for our schema).
  const model = process.env['OPENAI_EMBED_MODEL'] ?? 'text-embedding-3-small';

  const resp = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: text,
      // -3-large defaults to 3072. We want 1536 either way; -3-large supports
      // `dimensions` to ask the server to truncate (Matryoshka-style) for us.
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`openai embeddings ${resp.status}: ${body.slice(0, 200)}`);
  }
  const json = (await resp.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };
  const vec = json.data?.[0]?.embedding;
  if (!Array.isArray(vec)) throw new Error('openai response missing data[0].embedding');
  return conformShape(vec, 'openai');
}

/**
 * Embed an arbitrary text into a fixed-dimension vector. Always returns a
 * length-EMBEDDING_DIMENSIONS vector. Provider errors degrade to a zero-vector
 * and a warn-level log — never throws.
 */
export async function embedText(text: string): Promise<number[]> {
  if (PROVIDER === 'none') return zeroVector();

  const key = cacheKey(text);
  const hit = cacheGet(key);
  if (hit) return hit;

  try {
    const vec = PROVIDER === 'voyage'
      ? await embedViaVoyage(text)
      : await embedViaOpenAI(text);
    cacheSet(key, vec);
    return vec;
  } catch (err) {
    logger.warn(
      {
        err: err instanceof Error ? err.message : String(err),
        provider: PROVIDER,
      },
      '[memory.embedder] provider call failed; returning zero-vector',
    );
    return zeroVector();
  }
}

/**
 * Test-only: clear the in-process LRU cache. Not part of the public surface.
 */
export function __clearEmbedderCacheForTest(): void {
  cache.clear();
}
