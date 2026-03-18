/**
 * GoPlus Security Scanner for Solana tokens.
 *
 * Uses the free GoPlus Security API to detect honeypots, hidden mints,
 * blacklist functions, proxy contracts, high taxes, and other red flags.
 *
 * Results are cached for 5 minutes to avoid redundant API calls.
 */

// ── GoPlus API response types ─────────────────────────────────────────

interface GoPlusTokenSecurity {
  is_honeypot?: string;
  is_open_source?: string;
  is_proxy?: string;
  is_mintable?: string;
  can_take_back_ownership?: string;
  owner_change_balance?: string;
  hidden_owner?: string;
  selfdestruct?: string;
  external_call?: string;
  buy_tax?: string;
  sell_tax?: string;
  is_blacklisted?: string;
  is_whitelisted?: string;
  transfer_pausable?: string;
  trading_cooldown?: string;
  [key: string]: string | undefined;
}

interface GoPlusResponse {
  code: number;
  message: string;
  result: Record<string, GoPlusTokenSecurity>;
}

// ── Public report type ────────────────────────────────────────────────

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface GoPlusReport {
  safe: boolean;
  riskLevel: RiskLevel;
  score: number;
  flags: string[];
  raw: GoPlusTokenSecurity | null;
  fetchedAt: number;
}

// ── Cache (5-minute TTL) ──────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  report: GoPlusReport;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function getCached(mint: string): GoPlusReport | null {
  const entry = cache.get(mint);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(mint);
    return null;
  }
  return entry.report;
}

function setCache(mint: string, report: GoPlusReport): void {
  cache.set(mint, { report, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Expose for testing / manual invalidation */
export function clearCache(): void {
  cache.clear();
}

// ── Risk-level from score ─────────────────────────────────────────────

function riskLevelFromScore(score: number): RiskLevel {
  if (score >= 80) return 'low';
  if (score >= 60) return 'medium';
  if (score >= 30) return 'high';
  return 'critical';
}

// ── Helper: parse "1"/"0" string booleans ─────────────────────────────

function isFlag(value: string | undefined): boolean {
  return value === '1';
}

function parseTaxPercent(value: string | undefined): number {
  if (value === undefined || value === '') return 0;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed * 100 : 0;
}

// ── Scoring engine ────────────────────────────────────────────────────

function scoreToken(data: GoPlusTokenSecurity): { score: number; flags: string[]; forceCritical: boolean } {
  let score = 100;
  const flags: string[] = [];
  let forceCritical = false;

  // Honeypot — instant critical
  if (isFlag(data.is_honeypot)) {
    score = 0;
    forceCritical = true;
    flags.push('HONEYPOT DETECTED');
  }

  // Extreme sell tax — instant critical
  const sellTax = parseTaxPercent(data.sell_tax);
  if (sellTax > 20) {
    score = 0;
    forceCritical = true;
    flags.push(`EXTREME sell tax: ${sellTax.toFixed(1)}%`);
  } else if (sellTax > 5) {
    score -= 15;
    flags.push(`High sell tax: ${sellTax.toFixed(1)}%`);
  }

  // Buy tax
  const buyTax = parseTaxPercent(data.buy_tax);
  if (buyTax > 5) {
    score -= 10;
    flags.push(`High buy tax: ${buyTax.toFixed(1)}%`);
  }

  // Mintable
  if (isFlag(data.is_mintable)) {
    score -= 30;
    flags.push('Token is mintable (can create unlimited supply)');
  }

  // Proxy (upgradeable)
  if (isFlag(data.is_proxy)) {
    score -= 20;
    flags.push('Proxy contract (upgradeable)');
  }

  // Owner can change balances
  if (isFlag(data.owner_change_balance)) {
    score -= 20;
    flags.push('Owner can change balances');
  }

  // Selfdestruct
  if (isFlag(data.selfdestruct)) {
    score -= 20;
    flags.push('Self-destruct function detected');
  }

  // Hidden owner
  if (isFlag(data.hidden_owner)) {
    score -= 15;
    flags.push('Hidden owner detected');
  }

  // Transfer pausable
  if (isFlag(data.transfer_pausable)) {
    score -= 15;
    flags.push('Transfers can be paused');
  }

  // Blacklist
  if (isFlag(data.is_blacklisted)) {
    score -= 10;
    flags.push('Blacklist function exists');
  }

  // Can take back ownership
  if (isFlag(data.can_take_back_ownership)) {
    score -= 10;
    flags.push('Owner can reclaim ownership');
  }

  // Clamp score to 0
  score = Math.max(0, score);

  return { score, flags, forceCritical };
}

// ── Main scan function ────────────────────────────────────────────────

const GOPLUS_API_BASE = 'https://api.gopluslabs.io/api/v1/solana/token_security';
const FETCH_TIMEOUT_MS = 5_000;

export async function scanToken(mint: string): Promise<GoPlusReport> {
  // Check cache first
  const cached = getCached(mint);
  if (cached) return cached;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const url = `${GOPLUS_API_BASE}?contract_addresses=${encodeURIComponent(mint)}`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      const fallback = buildFallbackReport();
      setCache(mint, fallback);
      return fallback;
    }

    const json = (await res.json()) as GoPlusResponse;

    if (json.code !== 1 || !json.result) {
      const fallback = buildFallbackReport();
      setCache(mint, fallback);
      return fallback;
    }

    // GoPlus keys the result by lowercase address
    const mintLower = mint.toLowerCase();
    const tokenData = json.result[mintLower] ?? json.result[mint];

    if (!tokenData) {
      // Token not found in GoPlus DB — return neutral
      const report: GoPlusReport = {
        safe: true,
        riskLevel: 'medium',
        score: 50,
        flags: ['Token not found in GoPlus database — limited data'],
        raw: null,
        fetchedAt: Date.now(),
      };
      setCache(mint, report);
      return report;
    }

    const { score, flags, forceCritical } = scoreToken(tokenData);
    const riskLevel = forceCritical ? 'critical' : riskLevelFromScore(score);
    const safe = riskLevel === 'low' || riskLevel === 'medium';

    const report: GoPlusReport = {
      safe,
      riskLevel,
      score,
      flags,
      raw: tokenData,
      fetchedAt: Date.now(),
    };
    setCache(mint, report);
    return report;
  } catch {
    const fallback = buildFallbackReport();
    setCache(mint, fallback);
    return fallback;
  }
}

// ── Fallback when API is unavailable ──────────────────────────────────

function buildFallbackReport(): GoPlusReport {
  return {
    safe: true,
    riskLevel: 'medium',
    score: 50,
    flags: ['GoPlus API unavailable — scan inconclusive'],
    raw: null,
    fetchedAt: Date.now(),
  };
}
