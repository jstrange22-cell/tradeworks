/**
 * Token Art Generator — Creates custom logos and images for launched tokens
 *
 * Generates SVG-based artwork customized per token:
 * - Category-specific color schemes and icons
 * - Token ticker prominently displayed
 * - Gradient backgrounds with themed patterns
 *
 * Outputs: PNG via sharp (if available) or SVG uploaded directly to Pinata IPFS
 */

import { logger } from '../../lib/logger.js';

// ── Category Themes ──────────────────────────────────────────────────────

interface CategoryTheme {
  bg1: string;        // Gradient start
  bg2: string;        // Gradient end
  accent: string;     // Text/icon color
  emoji: string;      // Category emoji for the logo
  pattern: string;    // SVG pattern element
}

const THEMES: Record<string, CategoryTheme> = {
  'animal/dog': {
    bg1: '#FF6B35', bg2: '#F7C548', accent: '#FFFFFF',
    emoji: '🐕',
    pattern: '<circle cx="30" cy="30" r="8" fill="rgba(255,255,255,0.1)"/><circle cx="70" cy="70" r="5" fill="rgba(255,255,255,0.08)"/><circle cx="20" cy="80" r="6" fill="rgba(255,255,255,0.06)"/>',
  },
  'animal/cat': {
    bg1: '#9B59B6', bg2: '#E91E63', accent: '#FFFFFF',
    emoji: '🐱',
    pattern: '<path d="M25,25 Q50,10 75,25" stroke="rgba(255,255,255,0.1)" fill="none" stroke-width="2"/><path d="M20,60 Q50,45 80,60" stroke="rgba(255,255,255,0.08)" fill="none" stroke-width="2"/>',
  },
  'animal/frog': {
    bg1: '#27AE60', bg2: '#2ECC71', accent: '#FFFFFF',
    emoji: '🐸',
    pattern: '<circle cx="25" cy="25" r="10" fill="rgba(255,255,255,0.08)"/><circle cx="75" cy="75" r="12" fill="rgba(255,255,255,0.06)"/>',
  },
  'animal/primate': {
    bg1: '#8B4513', bg2: '#D2691E', accent: '#FFD700',
    emoji: '🦍',
    pattern: '<rect x="20" y="60" width="15" height="15" rx="3" fill="rgba(255,255,255,0.08)"/><rect x="60" y="20" width="12" height="12" rx="2" fill="rgba(255,255,255,0.06)"/>',
  },
  'animal/bird': {
    bg1: '#00BCD4', bg2: '#4FC3F7', accent: '#FFFFFF',
    emoji: '🦅',
    pattern: '<path d="M10,50 Q30,20 50,50 Q70,20 90,50" stroke="rgba(255,255,255,0.1)" fill="none" stroke-width="1.5"/>',
  },
  'animal/sea': {
    bg1: '#1565C0', bg2: '#0D47A1', accent: '#4FC3F7',
    emoji: '🐋',
    pattern: '<path d="M0,60 Q25,40 50,60 Q75,80 100,60" stroke="rgba(255,255,255,0.08)" fill="none" stroke-width="2"/><path d="M0,40 Q25,20 50,40 Q75,60 100,40" stroke="rgba(255,255,255,0.05)" fill="none" stroke-width="2"/>',
  },
  'animal/wild': {
    bg1: '#F44336', bg2: '#FF5722', accent: '#FFEB3B',
    emoji: '🦁',
    pattern: '<polygon points="50,15 58,35 80,35 62,48 68,70 50,55 32,70 38,48 20,35 42,35" fill="rgba(255,255,255,0.06)"/>',
  },
  'ai': {
    bg1: '#00E5FF', bg2: '#651FFF', accent: '#FFFFFF',
    emoji: '🤖',
    pattern: '<rect x="20" y="20" width="2" height="60" fill="rgba(255,255,255,0.05)"/><rect x="40" y="10" width="2" height="80" fill="rgba(255,255,255,0.04)"/><rect x="60" y="25" width="2" height="50" fill="rgba(255,255,255,0.05)"/><rect x="80" y="15" width="2" height="70" fill="rgba(255,255,255,0.03)"/>',
  },
  'political': {
    bg1: '#1A237E', bg2: '#B71C1C', accent: '#FFFFFF',
    emoji: '🗽',
    pattern: '<line x1="0" y1="0" x2="100" y2="100" stroke="rgba(255,255,255,0.05)" stroke-width="1"/><line x1="100" y1="0" x2="0" y2="100" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>',
  },
  'space': {
    bg1: '#0D0D2B', bg2: '#1A1A4E', accent: '#FFD700',
    emoji: '🚀',
    pattern: '<circle cx="15" cy="20" r="1" fill="rgba(255,255,255,0.4)"/><circle cx="45" cy="15" r="1.5" fill="rgba(255,255,255,0.3)"/><circle cx="75" cy="30" r="1" fill="rgba(255,255,255,0.5)"/><circle cx="85" cy="70" r="1.5" fill="rgba(255,255,255,0.3)"/><circle cx="30" cy="80" r="1" fill="rgba(255,255,255,0.4)"/><circle cx="60" cy="55" r="2" fill="rgba(255,255,255,0.2)"/>',
  },
  'food': {
    bg1: '#FF8F00', bg2: '#F4511E', accent: '#FFFFFF',
    emoji: '🍕',
    pattern: '<circle cx="25" cy="75" r="6" fill="rgba(255,255,255,0.06)"/><circle cx="75" cy="25" r="8" fill="rgba(255,255,255,0.05)"/>',
  },
  'wholesome': {
    bg1: '#E91E63', bg2: '#F48FB1', accent: '#FFFFFF',
    emoji: '💖',
    pattern: '<path d="M50,30 C50,20 35,15 35,25 C35,35 50,45 50,45 C50,45 65,35 65,25 C65,15 50,20 50,30Z" fill="rgba(255,255,255,0.06)"/>',
  },
  'meme': {
    bg1: '#7C4DFF', bg2: '#448AFF', accent: '#FFEB3B',
    emoji: '🔥',
    pattern: '<text x="15" y="30" font-size="12" fill="rgba(255,255,255,0.04)">LFG</text><text x="55" y="70" font-size="10" fill="rgba(255,255,255,0.03)">WAGMI</text>',
  },
  'gaming': {
    bg1: '#4CAF50', bg2: '#8BC34A', accent: '#FFFFFF',
    emoji: '🎮',
    pattern: '<rect x="30" y="40" width="8" height="8" rx="1" fill="rgba(255,255,255,0.06)"/><rect x="60" y="55" width="6" height="6" rx="1" fill="rgba(255,255,255,0.05)"/>',
  },
  'defi': {
    bg1: '#1B5E20', bg2: '#4CAF50', accent: '#C8E6C9',
    emoji: '💰',
    pattern: '<circle cx="50" cy="50" r="20" stroke="rgba(255,255,255,0.06)" fill="none" stroke-width="1"/><circle cx="50" cy="50" r="30" stroke="rgba(255,255,255,0.04)" fill="none" stroke-width="1"/>',
  },
  'sport': {
    bg1: '#E65100', bg2: '#FF9800', accent: '#FFFFFF',
    emoji: '⚽',
    pattern: '<circle cx="50" cy="50" r="15" stroke="rgba(255,255,255,0.08)" fill="none" stroke-width="2"/>',
  },
};

function getTheme(category: string): CategoryTheme {
  return THEMES[category] ?? THEMES['meme'];
}

// ── SVG Generation ───────────────────────────────────────────────────────

/** Generate a 500x500 token logo SVG */
export function generateLogoSVG(ticker: string, name: string, category: string): string {
  const theme = getTheme(category);
  const displayTicker = ticker.length > 5 ? ticker.slice(0, 5) : ticker;
  const fontSize = displayTicker.length <= 3 ? 72 : displayTicker.length <= 4 ? 60 : 48;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${theme.bg1}"/>
      <stop offset="100%" style="stop-color:${theme.bg2}"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="40%" r="50%">
      <stop offset="0%" style="stop-color:rgba(255,255,255,0.15)"/>
      <stop offset="100%" style="stop-color:rgba(255,255,255,0)"/>
    </radialGradient>
  </defs>
  <rect width="100" height="100" rx="20" fill="url(#bg)"/>
  <rect width="100" height="100" rx="20" fill="url(#glow)"/>
  ${theme.pattern}
  <text x="50" y="38" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" fill="rgba(255,255,255,0.9)">${theme.emoji}</text>
  <text x="50" y="65" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="${fontSize * 0.18}" fill="${theme.accent}" letter-spacing="2">$${displayTicker}</text>
  <text x="50" y="82" text-anchor="middle" font-family="Arial,sans-serif" font-size="7" fill="rgba(255,255,255,0.5)">${name.slice(0, 20)}</text>
  <text x="50" y="93" text-anchor="middle" font-family="Arial,sans-serif" font-size="5" fill="rgba(255,255,255,0.3)">pump.fun</text>
</svg>`;
}

/** Generate a 1200x630 Twitter card SVG */
export function generateTwitterCardSVG(ticker: string, name: string, category: string, hook: string): string {
  const theme = getTheme(category);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 120 63">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${theme.bg1}"/>
      <stop offset="100%" style="stop-color:${theme.bg2}"/>
    </linearGradient>
  </defs>
  <rect width="120" height="63" fill="url(#bg)"/>
  ${theme.pattern}
  <text x="15" y="20" font-family="Arial,sans-serif" font-size="8" fill="rgba(255,255,255,0.6)">Just launched on pump.fun ${theme.emoji}</text>
  <text x="15" y="35" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="14" fill="${theme.accent}" letter-spacing="1">$${ticker}</text>
  <text x="15" y="45" font-family="Arial,sans-serif" font-size="6" fill="rgba(255,255,255,0.7)">${name}</text>
  <text x="15" y="55" font-family="Arial,sans-serif" font-size="5" fill="rgba(255,255,255,0.5)">${hook.slice(0, 60)}</text>
</svg>`;
}

// ── Upload to IPFS ───────────────────────────────────────────────────────

/**
 * Generate logo + upload to Pinata IPFS
 * Returns the IPFS URL of the uploaded image
 */
export async function generateAndUploadLogo(
  ticker: string, name: string, category: string,
): Promise<string | null> {
  const pinataJWT = process.env.PINATA_JWT;
  if (!pinataJWT) {
    logger.warn('[TokenArt] No PINATA_JWT — skipping logo upload');
    return null;
  }

  try {
    const svg = generateLogoSVG(ticker, name, category);
    const svgBlob = new File([svg], `${ticker.toLowerCase()}-logo.svg`, { type: 'image/svg+xml' });

    const formData = new FormData();
    formData.append('network', 'public');
    formData.append('file', svgBlob);

    const res = await fetch('https://uploads.pinata.cloud/v3/files', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${pinataJWT}` },
      body: formData,
      signal: AbortSignal.timeout(15_000),
    });

    if (res.ok) {
      const data = await res.json() as { data?: { cid?: string } };
      if (data.data?.cid) {
        const url = `https://ipfs.io/ipfs/${data.data.cid}`;
        logger.info({ ticker, url }, `[TokenArt] Logo uploaded: ${url}`);
        return url;
      }
    }

    logger.warn({ status: res.status }, `[TokenArt] Logo upload failed`);
    return null;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[TokenArt] Logo generation failed');
    return null;
  }
}
