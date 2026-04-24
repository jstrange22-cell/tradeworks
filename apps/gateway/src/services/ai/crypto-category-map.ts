/**
 * Crypto category map — mirror of sector-map.ts for diversification gating.
 * `canOpenCryptoPosition` caps concurrent positions per category so a bad
 * call on one theme (e.g. memecoins) can't sink the whole paper book.
 */

export type CryptoCategory = 'major' | 'L1' | 'defi' | 'memecoin' | 'L2_infra' | 'other';

export const SYMBOL_TO_CATEGORY: Record<string, CryptoCategory> = {
  // Majors
  BTC: 'major', ETH: 'major', SOL: 'major',
  // L1s
  AVAX: 'L1', NEAR: 'L1', DOT: 'L1', SUI: 'L1', APT: 'L1',
  ADA: 'L1', ATOM: 'L1', TIA: 'L1', SEI: 'L1', INJ: 'L1',
  // DeFi
  AAVE: 'defi', UNI: 'defi', LINK: 'defi', MKR: 'defi', LDO: 'defi',
  FIL: 'defi', RENDER: 'defi', FET: 'defi',
  // Memecoins
  DOGE: 'memecoin', SHIB: 'memecoin', WIF: 'memecoin', PEPE: 'memecoin',
  JASMY: 'memecoin', BONK: 'memecoin',
  // L2 / infrastructure
  ARB: 'L2_infra', OP: 'L2_infra', MATIC: 'L2_infra',
};

export function getCategory(symbol: string): CryptoCategory {
  const upper = symbol.toUpperCase().replace('-USD', '').replace('USDT', '');
  return SYMBOL_TO_CATEGORY[upper] ?? 'other';
}

/**
 * Cap per-category concurrent positions. Default 3 per category. The 'other'
 * bucket has no cap — it's the discovery slot for newly-watchlisted tokens.
 */
export function canOpenCryptoPosition(
  symbol: string,
  currentPositions: Array<{ symbol: string }>,
  maxPerCategory: number = 3,
): { allowed: boolean; reason?: string } {
  const targetCategory = getCategory(symbol);
  if (targetCategory === 'other') return { allowed: true };

  let countInCategory = 0;
  for (const pos of currentPositions) {
    if (getCategory(pos.symbol) === targetCategory) {
      countInCategory += 1;
    }
  }

  if (countInCategory >= maxPerCategory) {
    return {
      allowed: false,
      reason: `category_cap_reached:${targetCategory}:${countInCategory}/${maxPerCategory}`,
    };
  }
  return { allowed: true };
}
