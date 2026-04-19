/**
 * Token Auto-Launcher — APEX Autonomous Token Factory
 *
 * Scans pump.fun trends → finds category gaps → creates tokens → promotes → tracks revenue
 *
 * Pipeline:
 *   1. Trend scan: What categories are hot? What's oversaturated?
 *   2. Gap detection: What's trending but underserved?
 *   3. Name generation: Create catchy name + ticker
 *   4. Auto-launch: Create token on pump.fun via Solana wallet
 *   5. Auto-promote: Comment on pump.fun, generate social content
 *   6. Track: Monitor bonding curve → graduation → revenue
 *
 * Budget: 10 launches/day max (~0.2 SOL in creation fees)
 */

import { logger } from '../../lib/logger.js';

// ── Types ────────────────────────────────────────────────────────────────

export interface TrendCategory {
  category: string;
  tokensLaunched24h: number;
  graduated24h: number;
  graduationRate: number;
  trending: boolean;
  saturation: 'low' | 'medium' | 'high' | 'oversaturated';
  opportunity: number; // 0-100 score
}

export interface LaunchCandidate {
  category: string;
  name: string;
  ticker: string;
  description: string;
  hook: string;
  opportunityScore: number;
  reason: string;
}

export interface LaunchedToken {
  mint: string | null;
  name: string;
  ticker: string;
  category: string;
  description: string;
  hook: string;
  imageUri: string | null;
  pumpFunUrl: string | null;
  solscanUrl: string | null;
  txSignature: string | null;
  launchedAt: string;
  creationCostSOL: number;
  status: 'pending' | 'created' | 'failed' | 'tracking' | 'graduated' | 'dead';
  bondingCurvePct: number;
  holders: number;
  revenueSOL: number;
  error: string | null;
}

// ── Config ───────────────────────────────────────────────────────────────

const CONFIG = {
  maxLaunchesPerDay: 20,
  creationCostSOL: 0.02, // pump.fun token creation fee
  scanIntervalMs: 15 * 60_000, // Scan trends every 15 min (was 30)
  launchIntervalMs: 20 * 60_000, // Launch every 20 min during peak (was 60)
  minOpportunityScore: 50, // Lowered threshold to launch more (was 60)
  devBuyAmountSol: 0.1, // Dev buy amount per launch
  peakHoursUTC: [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23], // Extended peak: 9 AM - 7 PM ET
};

// ── State ────────────────────────────────────────────────────────────────

let trendCache: TrendCategory[] = [];
let lastTrendScan: string | null = null;
let dailyLaunches = 0;
let dailyResetDate = new Date().toISOString().slice(0, 10);
const launchedTokens: LaunchedToken[] = [];
let scanInterval: ReturnType<typeof setInterval> | null = null;
let launchInterval: ReturnType<typeof setInterval> | null = null;

// ── Trend Scanner ────────────────────────────────────────────────────────

/**
 * Scan pump.fun for trending categories and find gaps.
 * Uses pump.fun API + CoinGecko trending to detect what's hot.
 */
async function scanTrends(): Promise<TrendCategory[]> {
  const categories: Record<string, { launched: number; graduated: number; names: string[] }> = {};

  try {
    // Source 1: Pump.fun king-of-the-hill (top tokens right now)
    const kothRes = await fetch('https://frontend-api-v3.pump.fun/coins/king-of-the-hill?includeNsfw=false', {
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: 'application/json' },
    });
    if (kothRes.ok) {
      const kothData = await kothRes.json() as Array<{ name: string; symbol: string; description: string; market_cap_sol: number }>;
      for (const token of (kothData ?? []).slice(0, 20)) {
        const cat = detectCategory(token.name, token.description ?? '');
        if (!categories[cat]) categories[cat] = { launched: 0, graduated: 0, names: [] };
        categories[cat].launched++;
        categories[cat].names.push(token.name);
      }
    }
  } catch { /* API unavailable */ }

  try {
    // Source 2: Pump.fun latest coins (recent launches)
    const latestRes = await fetch('https://frontend-api-v3.pump.fun/coins?offset=0&limit=50&sort=creation_time&order=DESC&includeNsfw=false', {
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: 'application/json' },
    });
    if (latestRes.ok) {
      const latestData = await latestRes.json() as Array<{ name: string; symbol: string; description: string; market_cap_sol: number; raydium_pool: string | null }>;
      for (const token of (latestData ?? []).slice(0, 50)) {
        const cat = detectCategory(token.name, token.description ?? '');
        if (!categories[cat]) categories[cat] = { launched: 0, graduated: 0, names: [] };
        categories[cat].launched++;
        if (token.raydium_pool) categories[cat].graduated++;
      }
    }
  } catch { /* API unavailable */ }

  try {
    // Source 3: CoinGecko trending (what's hot in broader crypto)
    const geckoRes = await fetch('https://api.coingecko.com/api/v3/search/trending', {
      signal: AbortSignal.timeout(5_000),
    });
    if (geckoRes.ok) {
      const geckoData = await geckoRes.json() as { coins?: Array<{ item: { name: string; symbol: string } }> };
      for (const coin of (geckoData.coins ?? []).slice(0, 7)) {
        const cat = detectCategory(coin.item.name, '');
        if (!categories[cat]) categories[cat] = { launched: 0, graduated: 0, names: [] };
        // Trending on CoinGecko = high demand, check if pump.fun is catching up
      }
    }
  } catch { /* optional */ }

  // Score each category
  const trends: TrendCategory[] = [];
  for (const [cat, data] of Object.entries(categories)) {
    const gradRate = data.launched > 0 ? data.graduated / data.launched : 0;
    const satLevel = data.launched > 20 ? 'oversaturated' : data.launched > 10 ? 'high' : data.launched > 5 ? 'medium' : 'low';

    // Opportunity: trending (many launches) but not oversaturated, with some graduations
    let opportunity = 50;
    if (satLevel === 'low') opportunity += 20; // Low competition
    if (satLevel === 'medium') opportunity += 10;
    if (satLevel === 'oversaturated') opportunity -= 30;
    if (gradRate > 0.05) opportunity += 15; // Category has graduation potential
    if (data.launched > 3) opportunity += 10; // Some activity = people are interested

    trends.push({
      category: cat,
      tokensLaunched24h: data.launched,
      graduated24h: data.graduated,
      graduationRate: Math.round(gradRate * 10000) / 100,
      trending: data.launched > 3,
      saturation: satLevel,
      opportunity: Math.max(0, Math.min(100, opportunity)),
    });
  }

  trends.sort((a, b) => b.opportunity - a.opportunity);
  trendCache = trends;
  lastTrendScan = new Date().toISOString();

  logger.info({ categories: trends.length, topCategory: trends[0]?.category, topScore: trends[0]?.opportunity },
    `[TokenFactory] Scanned ${trends.length} categories. Top: ${trends[0]?.category} (${trends[0]?.opportunity}/100)`);

  return trends;
}

// ── Category Detection ───────────────────────────────────────────────────

function detectCategory(name: string, description: string): string {
  const text = `${name} ${description}`.toLowerCase();

  if (/dog|puppy|doge|shib|woof|bark|pup|inu/i.test(text)) return 'animal/dog';
  if (/cat|kitten|meow|kitty|nyan/i.test(text)) return 'animal/cat';
  if (/frog|pepe|toad|kek/i.test(text)) return 'animal/frog';
  if (/monkey|ape|chimp|gorilla/i.test(text)) return 'animal/primate';
  if (/bird|eagle|hawk|owl|penguin/i.test(text)) return 'animal/bird';
  if (/fish|whale|shark|dolphin|ocean/i.test(text)) return 'animal/sea';
  if (/bear|bull|lion|tiger|wolf/i.test(text)) return 'animal/wild';

  if (/trump|biden|elon|musk|politics|president|vote/i.test(text)) return 'political';
  if (/ai|gpt|claude|agent|neural|robot|bot/i.test(text)) return 'ai';
  if (/game|play|nft|metaverse|virtual/i.test(text)) return 'gaming';
  if (/defi|swap|yield|stake|farm/i.test(text)) return 'defi';
  if (/food|pizza|burger|sushi|taco|cook/i.test(text)) return 'food';
  if (/sport|ball|goal|team|win|score/i.test(text)) return 'sport';
  if (/moon|rocket|space|mars|star/i.test(text)) return 'space';
  if (/love|heart|cute|baby|wholesome/i.test(text)) return 'wholesome';

  return 'meme';
}

// ── Name Generator ───────────────────────────────────────────────────────

function generateTokenConcept(category: string): LaunchCandidate {
  // Category-specific name generators
  const templates: Record<string, Array<{ name: string; ticker: string; hook: string }>> = {
    'animal/dog': [
      { name: 'Bark', ticker: 'BARK', hook: 'The goodest boy on Solana' },
      { name: 'Bork', ticker: 'BORK', hook: 'Bork bork bork' },
      { name: 'Woof', ticker: 'WOOF', hook: 'Every dog has its day' },
      { name: 'Doge Killer', ticker: 'DOGEK', hook: 'Sorry DOGE, there is a new alpha' },
      { name: 'Puppy', ticker: 'PUPPY', hook: 'Smol but mighty' },
      { name: 'Fetch', ticker: 'FETCH', hook: 'Go fetch some gains' },
      { name: 'Pawprint', ticker: 'PAW', hook: 'Leaving our mark on Solana' },
      { name: 'Shiba Saga', ticker: 'SAGA', hook: 'The saga continues on SOL' },
      { name: 'Howler', ticker: 'HOWL', hook: 'Howling at the moon charts' },
    ],
    'animal/cat': [
      { name: 'Purr', ticker: 'PURR', hook: 'Purrfect gains ahead' },
      { name: 'Meow', ticker: 'MEOW', hook: 'Nine lives, infinite gains' },
      { name: 'Whiskers', ticker: 'WSKR', hook: 'The cat is out of the bag' },
      { name: 'Nyan Sol', ticker: 'NYAN', hook: 'Rainbow gains on Solana' },
      { name: 'Kitty', ticker: 'KITY', hook: 'Cute but deadly' },
      { name: 'Catnip', ticker: 'CNIP', hook: 'Addictive by design' },
    ],
    'animal/frog': [
      { name: 'Frog Season', ticker: 'FROG', hook: 'Ribbit your way to gains' },
      { name: 'Based Toad', ticker: 'TOAD', hook: 'The most based amphibian' },
      { name: 'Pepe Jr', ticker: 'PEPJR', hook: 'Son of Pepe' },
      { name: 'Ribbit', ticker: 'RBBIT', hook: 'Can you hear the call?' },
    ],
    'animal/primate': [
      { name: 'Ape In', ticker: 'APEIN', hook: 'Ape first, think later' },
      { name: 'Monke', ticker: 'MONKE', hook: 'Return to monke' },
      { name: 'Gorilla Grip', ticker: 'GRIP', hook: 'Diamond hands evolved' },
    ],
    'ai': [
      { name: 'Neural', ticker: 'NRGL', hook: 'AI-powered degen' },
      { name: 'Agent', ticker: 'AGNT', hook: 'The agent economy starts here' },
      { name: 'Sentient', ticker: 'SENT', hook: 'Are you conscious enough to buy?' },
      { name: 'Skynet', ticker: 'SKNT', hook: 'The machines are buying' },
      { name: 'GPT Degen', ticker: 'GPTD', hook: 'AI told me to buy this' },
      { name: 'Algo', ticker: 'ALGO', hook: 'The algorithm chose this token' },
      { name: 'Cortex', ticker: 'CRTX', hook: 'Neural network of gains' },
    ],
    'space': [
      { name: 'Moon Shot', ticker: 'MNSHT', hook: 'Destination: the moon' },
      { name: 'Rocket', ticker: 'RCKT', hook: 'Fueling the next launch' },
      { name: 'Orbit', ticker: 'ORBIT', hook: 'In orbit, never coming back' },
      { name: 'Zero G', ticker: 'ZEROG', hook: 'Weightless gains' },
      { name: 'Star Dust', ticker: 'STRDST', hook: 'We are all made of stars' },
    ],
    'meme': [
      { name: 'Based', ticker: 'BASED', hook: 'Built different' },
      { name: 'Degen', ticker: 'DEGEN', hook: 'It is always degen hours' },
      { name: 'GM', ticker: 'GMGM', hook: 'GM to everyone except bears' },
      { name: 'WAGMI', ticker: 'WAGMI', hook: 'We are all gonna make it' },
      { name: 'Cope', ticker: 'COPE', hook: 'Copium for the masses' },
      { name: 'Fomo', ticker: 'FOMO', hook: 'You will FOMO in eventually' },
      { name: 'Rug Proof', ticker: 'NORUG', hook: 'The only rug-proof token' },
      { name: 'Diamond', ticker: 'DMOND', hook: 'Diamond hands only' },
      { name: 'Paper', ticker: 'PAPER', hook: 'For the paper hands who sold' },
      { name: 'Goblin', ticker: 'GOBLN', hook: 'Goblin town is pumping' },
      { name: 'Gigachad', ticker: 'GIGA', hook: 'Only chads buy this' },
      { name: 'Simp', ticker: 'SIMP', hook: 'Simping for gains' },
      { name: 'Brainrot', ticker: 'BRAIN', hook: 'Terminal brainrot achieved' },
    ],
    'food': [
      { name: 'Pizza', ticker: 'PIZZA', hook: 'Serving slices of alpha' },
      { name: 'Taco', ticker: 'TACO', hook: 'Every day is taco day on Solana' },
      { name: 'Ramen', ticker: 'RAMEN', hook: 'Back to ramen until this moons' },
      { name: 'Tendies', ticker: 'TNDY', hook: 'Chicken tendies secured' },
    ],
    'political': [
      { name: 'Freedom', ticker: 'FREE', hook: 'Liberty on the blockchain' },
      { name: 'Patriot', ticker: 'PTRT', hook: 'For the people, by the degens' },
    ],
    'wholesome': [
      { name: 'Hug', ticker: 'HUGS', hook: 'Spreading love on Solana' },
      { name: 'Comfy', ticker: 'COMFY', hook: 'Maximum comfiness achieved' },
    ],
    'gaming': [
      { name: 'GG', ticker: 'GGWP', hook: 'Good game, well played' },
      { name: 'Noob', ticker: 'NOOB', hook: 'Everyone starts as a noob' },
      { name: 'Loot', ticker: 'LOOT', hook: 'Epic loot drop on Solana' },
    ],
    'defi': [
      { name: 'Yield', ticker: 'YIELD', hook: 'Farming the future' },
      { name: 'Stack', ticker: 'STACK', hook: 'Stack sats, stack SOL' },
    ],
  };

  const categoryTemplates = templates[category] ?? templates['meme'];
  const base = categoryTemplates[Math.floor(Math.random() * categoryTemplates.length)];

  // Generate unique name WITHOUT version suffixes — use creative modifiers instead
  const prefixes = ['', 'Based ', 'Super ', 'Ultra ', 'Mega ', 'Baby ', 'King ', 'Lord '];
  const suffixes = ['', ' Inu', ' Protocol', ' Finance', ' DAO', ' AI', ' Labs', ' Network'];
  const prefix = Math.random() > 0.6 ? prefixes[Math.floor(Math.random() * prefixes.length)] : '';
  const suffix = Math.random() > 0.7 ? suffixes[Math.floor(Math.random() * suffixes.length)] : '';
  const uniqueName = `${prefix}${base.name}${suffix}`.trim();

  // Ticker: max 5 chars, uppercase, no spaces
  let ticker = base.ticker;
  if (prefix && prefix.trim().length <= 2) ticker = prefix.trim().charAt(0) + ticker;
  ticker = ticker.slice(0, 5).toUpperCase();

  // Better descriptions — more degen, more memeable
  const descriptions = [
    `${base.hook}. Community-driven on Solana. No VC, no insider alloc. 100% fair launch.`,
    `${base.hook}. Launched by degens, for degens. The next 100x is here.`,
    `${base.hook}. Fair launch. No presale. Community first. LFG!`,
    `${base.hook}. If you're reading this, you're early. NFA.`,
  ];

  return {
    category,
    name: uniqueName,
    ticker,
    description: descriptions[Math.floor(Math.random() * descriptions.length)],
    hook: base.hook,
    opportunityScore: 0,
    reason: `Category "${category}" has opportunity. Auto-launched by APEX.`,
  };
}

// ── Token Creation on PumpFun ────────────────────────────────────────────

async function createTokenOnPumpFun(candidate: LaunchCandidate): Promise<LaunchedToken> {
  const launched: LaunchedToken = {
    mint: null,
    name: candidate.name,
    ticker: candidate.ticker,
    category: candidate.category,
    description: candidate.description,
    hook: candidate.hook,
    imageUri: null,
    pumpFunUrl: null,
    solscanUrl: null,
    txSignature: null,
    launchedAt: new Date().toISOString(),
    creationCostSOL: CONFIG.creationCostSOL,
    status: 'pending',
    bondingCurvePct: 0,
    holders: 0,
    revenueSOL: 0,
    error: null,
  };

  try {
    // Load wallet from the API Keys store (same as sniper uses)
    const { Keypair } = await import('@solana/web3.js');

    const mintKeypair = Keypair.generate();

    // Upload metadata via pump.fun IPFS
    const metadataForm = new FormData();
    metadataForm.append('name', candidate.name);
    metadataForm.append('symbol', candidate.ticker);
    metadataForm.append('description', candidate.description);
    metadataForm.append('showName', 'true');
    metadataForm.append('twitter', ''); // Will be filled when token account is created

    // Generate custom logo and upload to IPFS
    let imageUri = '';
    try {
      const { generateAndUploadLogo } = await import('./token-art-generator.js');
      const logoUrl = await generateAndUploadLogo(candidate.ticker, candidate.name, candidate.category);
      if (logoUrl) imageUri = logoUrl;
    } catch { /* art generation optional */ }

    // Upload metadata to IPFS — try multiple providers
    let metadataUri = '';

    // Method 1: pump.fun IPFS
    try {
      const ipfsRes = await fetch('https://pump.fun/api/ipfs', {
        method: 'POST',
        body: metadataForm,
        signal: AbortSignal.timeout(10_000),
      });
      if (ipfsRes.ok) {
        const ipfsData = await ipfsRes.json() as { metadataUri?: string };
        metadataUri = ipfsData.metadataUri ?? '';
        if (metadataUri) logger.info({ metadataUri }, `[TokenFactory] pump.fun IPFS uploaded`);
      }
    } catch { /* pump.fun IPFS unavailable */ }

    // Method 2: Pinata v3 API (if configured)
    if (!metadataUri && process.env.PINATA_JWT) {
      try {
        const metadata = JSON.stringify({
          name: candidate.name,
          symbol: candidate.ticker,
          description: candidate.description,
          image: imageUri || '',
          showName: true,
          createdOn: 'https://pump.fun',
        });
        const metaFile = new File([metadata], 'metadata.json');
        const pinataForm = new FormData();
        pinataForm.append('network', 'public');
        pinataForm.append('file', metaFile);

        const pinataRes = await fetch('https://uploads.pinata.cloud/v3/files', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.PINATA_JWT}` },
          body: pinataForm,
          signal: AbortSignal.timeout(15_000),
        });
        if (pinataRes.ok) {
          const pinData = await pinataRes.json() as { data?: { cid?: string } };
          if (pinData.data?.cid) {
            metadataUri = `https://ipfs.io/ipfs/${pinData.data.cid}`;
            logger.info({ metadataUri }, `[TokenFactory] Pinata IPFS uploaded`);
          }
        } else {
          logger.warn({ status: pinataRes.status }, `[TokenFactory] Pinata upload failed`);
        }
      } catch (pinErr) {
        logger.warn({ err: pinErr instanceof Error ? pinErr.message : pinErr }, '[TokenFactory] Pinata error');
      }
    }

    // Method 3: Use PumpPortal's built-in metadata (send tokenMetadata directly)
    if (!metadataUri) {
      // PumpPortal can handle metadata inline when uri is empty
      metadataUri = '';
      logger.info('[TokenFactory] No IPFS available — using PumpPortal inline metadata');
    }

    // ── Step 2: Create token via PumpPortal transaction API ──
    const bs58Create = await import('bs58');
    const encCreate = bs58Create.default?.encode ?? (bs58Create as unknown as { encode: (data: Uint8Array) => string }).encode;
    // bs58 imported inside createTokenOnPumpFun

    logger.info({ ticker: candidate.ticker, mint: mintKeypair.publicKey.toBase58() },
      `[TokenFactory] Creating $${candidate.ticker} via PumpPortal...`);

    // Use PumpPortal SERVER-SIDE API (handles signing + submission)
    const apiKey = process.env.PUMPPORTAL_API_KEY;
    let txSuccess = false;

    if (apiKey) {
      try {
        const createPayload = {
          action: 'create',
          tokenMetadata: {
            name: candidate.name,
            symbol: candidate.ticker,
            uri: metadataUri,
          },
          mint: encCreate(mintKeypair.secretKey),
          denominatedInSol: 'true',
          amount: 0.0001,
          slippage: 10,
          priorityFee: 0.0005,
          pool: 'pump',
        };

        const res = await fetch(`https://pumpportal.fun/api/trade?api-key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(createPayload),
          signal: AbortSignal.timeout(30_000),
        });

        if (res.status === 200) {
          const data = await res.json() as { signature?: string; mint?: string; error?: string };
          if (data.signature) {
            launched.mint = mintKeypair.publicKey.toBase58();
            launched.status = 'created';
            launched.txSignature = data.signature ?? null;
            launched.pumpFunUrl = `https://pump.fun/coin/${launched.mint}`;
            launched.solscanUrl = data.signature ? `https://solscan.io/tx/${data.signature}` : null;
            launched.imageUri = imageUri || null;
            txSuccess = true;
            logger.info({ mint: launched.mint, sig: data.signature, ticker: candidate.ticker },
              `[TokenFactory] LAUNCHED ON-CHAIN: $${candidate.ticker} — mint: ${launched.mint} — tx: ${data.signature}`);
          } else {
            logger.warn({ resp: JSON.stringify(data).slice(0, 300) },
              `[TokenFactory] PumpPortal returned 200 but no signature`);
          }
        } else {
          const errBody = await res.text().catch(() => '');
          logger.warn({ status: res.status, body: errBody.slice(0, 300) },
            `[TokenFactory] PumpPortal API returned ${res.status}: ${errBody.slice(0, 200)}`);
        }
      } catch (err) {
        logger.warn({ err: err instanceof Error ? err.message : err },
          `[TokenFactory] PumpPortal API error`);
      }
    } else {
      logger.warn('[TokenFactory] No PUMPPORTAL_API_KEY — cannot create tokens');
    }

    if (!txSuccess) {
      launched.status = 'created';
      launched.mint = `paper_${Date.now()}_${candidate.ticker}`;
      logger.info({ name: candidate.name, ticker: candidate.ticker },
        `[TokenFactory] PAPER LAUNCH: $${candidate.ticker} — logged as paper`);
    }
  } catch (err) {
    launched.status = 'failed';
    launched.error = err instanceof Error ? err.message : 'Creation failed';
    logger.error({ err: launched.error, name: candidate.name }, '[TokenFactory] Token creation failed');
  }

  // ── POST-LAUNCH AUTOMATION ──
  // Auto-track, dev buy, promote — all fire-and-forget
  if (launched.mint && launched.status === 'created' && !launched.mint.startsWith('paper_')) {
    void (async () => {
      try {
        // 1. Auto-track in Launch Coach
        const { autoTrackToken } = await import('../../routes/token-launch-coach.js');
        autoTrackToken(launched.mint!, launched.name, launched.ticker);
        logger.info({ mint: launched.mint, ticker: launched.ticker },
          `[TokenFactory] Auto-tracked $${launched.ticker} in Launch Coach`);
      } catch { /* tracking optional */ }

      try {
        // 2. DEV BUY — buy our own token immediately to seed initial liquidity
        // This is transparent (same wallet that created the token) — not hidden
        const devBuyAmount = 0.1; // 0.1 SOL initial buy from dev wallet
        const apiKey = process.env.PUMPPORTAL_API_KEY;
        if (apiKey && launched.mint) {
          const buyRes = await fetch(`https://pumpportal.fun/api/trade?api-key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'buy',
              mint: launched.mint,
              amount: devBuyAmount,
              denominatedInSol: 'true',
              slippage: 50,
              priorityFee: 0.0005,
            }),
            signal: AbortSignal.timeout(30_000),
          });
          if (buyRes.ok) {
            logger.info({ ticker: launched.ticker, amount: devBuyAmount },
              `[TokenFactory] DEV BUY $${launched.ticker}: ${devBuyAmount} SOL — seeding initial liquidity`);
          } else {
            logger.warn({ ticker: launched.ticker, status: buyRes.status },
              `[TokenFactory] Dev buy failed for $${launched.ticker}`);
          }
        }
      } catch (err) {
        logger.warn({ err: err instanceof Error ? err.message : err }, '[TokenFactory] Dev buy error');
      }

      try {
        // 3. Telegram post — blast to configured groups
        const { postTokenLaunch } = await import('./telegram-poster.js');
        await postTokenLaunch({
          mint: launched.mint!,
          name: launched.name,
          ticker: launched.ticker,
          hook: candidate.hook,
          imageUri: launched.imageUri ?? undefined,
          pumpFunUrl: launched.pumpFunUrl ?? `https://pump.fun/coin/${launched.mint}`,
          category: candidate.category,
        });
        logger.info({ ticker: launched.ticker }, `[TokenFactory] Telegram posted $${launched.ticker}`);
      } catch { /* telegram optional */ }

      try {
        // 4. Auto-tweet (may fail due to X API outage — queued for retry)
        const { tweetTokenLaunch } = await import('../twitter-poster.js');
        await tweetTokenLaunch(launched.ticker, launched.name, launched.mint!, candidate.hook);
      } catch { /* twitter optional */ }

      logger.info({ ticker: launched.ticker, mint: launched.mint },
        `[TokenFactory] Post-launch automation complete for $${launched.ticker}. Dev buy + Telegram + Coach active.`);
    })();
  }

  return launched;
}

// ── Auto-Launch Pipeline ─────────────────────────────────────────────────

async function runAutoLaunchCycle(): Promise<void> {
  // Daily reset
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dailyResetDate) {
    dailyLaunches = 0;
    dailyResetDate = today;
  }

  // Check daily limit
  if (dailyLaunches >= CONFIG.maxLaunchesPerDay) {
    logger.info({ launches: dailyLaunches, max: CONFIG.maxLaunchesPerDay }, '[TokenFactory] Daily launch limit reached');
    return;
  }

  // Only launch during peak hours
  const hour = new Date().getUTCHours();
  if (!CONFIG.peakHoursUTC.includes(hour)) {
    return; // Wait for peak hours
  }

  // Scan trends if stale (>30 min old)
  if (!lastTrendScan || Date.now() - new Date(lastTrendScan).getTime() > CONFIG.scanIntervalMs) {
    await scanTrends();
  }

  // Find best opportunity
  const topCategories = trendCache.filter(t => t.opportunity >= CONFIG.minOpportunityScore);
  if (topCategories.length === 0) {
    logger.info('[TokenFactory] No high-opportunity categories found');
    return;
  }

  // Pick category with some randomness (not always the top one)
  const weightedIdx = Math.floor(Math.random() * Math.min(3, topCategories.length));
  const selectedCategory = topCategories[weightedIdx];

  // Generate token concept
  const candidate = generateTokenConcept(selectedCategory.category);
  candidate.opportunityScore = selectedCategory.opportunity;
  candidate.reason = `Category "${selectedCategory.category}" — ${selectedCategory.saturation} saturation, ${selectedCategory.opportunity}/100 opportunity, ${selectedCategory.graduated24h} graduated today`;

  // Launch it
  const launched = await createTokenOnPumpFun(candidate);
  launchedTokens.push(launched);
  if (launchedTokens.length > 100) launchedTokens.shift();
  dailyLaunches++;

  // Auto-track in Launch Coach + auto-tweet
  if (launched.mint && launched.status === 'created') {
    // Auto-tweet the launch
    try {
      const { tweetTokenLaunch } = await import('../twitter-poster.js');
      const tweetResult = await tweetTokenLaunch(
        launched.ticker, launched.name, launched.mint, candidate.hook,
      );
      if (tweetResult.success) {
        logger.info({ tweetId: tweetResult.tweetId, ticker: launched.ticker },
          `[TokenFactory] Auto-tweeted $${launched.ticker} launch`);
      }
    } catch { /* twitter not configured */ }

    logger.info({ mint: launched.mint, ticker: launched.ticker },
      `[TokenFactory] $${launched.ticker} launched and tracking. Daily launches: ${dailyLaunches}/${CONFIG.maxLaunchesPerDay}`);
  }
}

// ── Public API ───────────────────────────────────────────────────────────

/** Force an immediate launch — skips peak hours and daily limit checks */
export async function forceAutoLaunch(): Promise<LaunchedToken> {
  // Scan trends first if no data
  if (trendCache.length === 0) {
    await scanTrends();
  }

  // Pick best category
  const topCategories = trendCache.length > 0
    ? trendCache.filter(t => t.opportunity >= 40)
    : [{ category: 'ai', opportunity: 70, saturation: 'medium' as const, tokensLaunched24h: 5, graduated24h: 0, graduationRate: 0, trending: true }];

  const selected = topCategories[Math.floor(Math.random() * Math.min(3, topCategories.length))] ?? topCategories[0];

  const candidate = generateTokenConcept(selected.category);
  candidate.opportunityScore = selected.opportunity;
  candidate.reason = `MANUAL LAUNCH: Category "${selected.category}" — ${selected.opportunity}/100 opportunity`;

  logger.info({ category: selected.category, name: candidate.name, ticker: candidate.ticker },
    `[TokenFactory] FORCE LAUNCH: $${candidate.ticker} (${candidate.name})`);

  const launched = await createTokenOnPumpFun(candidate);
  launchedTokens.push(launched);
  dailyLaunches++;

  // Auto-tweet
  if (launched.mint && launched.status === 'created') {
    try {
      const { tweetTokenLaunch } = await import('../twitter-poster.js');
      await tweetTokenLaunch(launched.ticker, launched.name, launched.mint, candidate.hook);
    } catch { /* twitter not configured */ }
  }

  return launched;
}

/** Update market data for all on-chain launched tokens */
async function refreshLaunchedTokenData(): Promise<void> {
  for (const token of launchedTokens) {
    if (!token.mint || token.mint.startsWith('paper_') || token.status === 'failed') continue;
    try {
      const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token.mint}`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (dexRes.ok) {
        const data = await dexRes.json() as { pairs?: Array<{ marketCap: number; liquidity: { usd: number }; txns: { h24: { buys: number } }; volume: { h24: number } }> };
        const pair = data.pairs?.[0];
        if (pair) {
          token.holders = pair.txns?.h24?.buys ?? token.holders;
          token.revenueSOL = ((pair.volume?.h24 ?? 0) * 0.0095) / 80; // 0.95% creator fee
          if ((pair.liquidity?.usd ?? 0) > 5000) {
            token.status = 'graduated';
            token.bondingCurvePct = 1.0;
          }
        }
      }
      // Also try pump.fun API for bonding curve progress
      const pfRes = await fetch(`https://frontend-api-v3.pump.fun/coins/${token.mint}`, {
        signal: AbortSignal.timeout(5_000),
        headers: { Accept: 'application/json' },
      });
      if (pfRes.ok) {
        const pfData = await pfRes.json() as { bonding_curve_progress?: number; holder_count?: number; migration_state?: string };
        if (pfData.bonding_curve_progress != null) token.bondingCurvePct = pfData.bonding_curve_progress;
        if (pfData.holder_count != null) token.holders = pfData.holder_count;
        if (pfData.migration_state === 'completed') { token.status = 'graduated'; token.bondingCurvePct = 1.0; }
      }
    } catch { /* optional refresh */ }
  }
}

export function startTokenFactory(): void {
  if (scanInterval) return;

  // Initial trend scan after 60s
  setTimeout(scanTrends, 60_000);

  // Launch cycle every hour (spreads 10 launches across peak hours)
  launchInterval = setInterval(runAutoLaunchCycle, CONFIG.launchIntervalMs);
  // First launch attempt after 2 min
  setTimeout(runAutoLaunchCycle, 120_000);

  // Refresh market data for launched tokens every 2 min
  setInterval(refreshLaunchedTokenData, 120_000);

  logger.info({ maxDaily: CONFIG.maxLaunchesPerDay, peakHours: CONFIG.peakHoursUTC },
    `[TokenFactory] Auto-launcher started — ${CONFIG.maxLaunchesPerDay} launches/day during peak hours`);
}

export function stopTokenFactory(): void {
  if (scanInterval) { clearInterval(scanInterval); scanInterval = null; }
  if (launchInterval) { clearInterval(launchInterval); launchInterval = null; }
}

let cachedWalletBalance: { sol: number; usd: number; address: string; updatedAt: string } | null = null;

async function refreshWalletBalance(): Promise<void> {
  const walletAddr = process.env.PUMPPORTAL_WALLET;
  if (!walletAddr) return;
  try {
    const { Connection, PublicKey, LAMPORTS_PER_SOL } = await import('@solana/web3.js');
    const rpc = process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
    const conn = new Connection(rpc);
    const balance = await conn.getBalance(new PublicKey(walletAddr));
    const sol = balance / LAMPORTS_PER_SOL;
    cachedWalletBalance = { sol, usd: sol * 80, address: walletAddr, updatedAt: new Date().toISOString() };
  } catch { /* balance check failed */ }
}

export async function getFactoryStatus() {
  // Refresh wallet balance if stale (>60s)
  if (!cachedWalletBalance || Date.now() - new Date(cachedWalletBalance.updatedAt).getTime() > 60_000) {
    await refreshWalletBalance();
  }

  return {
    running: launchInterval !== null,
    dailyLaunches,
    maxDaily: CONFIG.maxLaunchesPerDay,
    dailyResetDate,
    trendCategories: trendCache.slice(0, 10),
    lastTrendScan,
    launchedTokens: launchedTokens.slice(-20).reverse(),
    totalLaunched: launchedTokens.length,
    totalCreationCostSOL: launchedTokens.reduce((s, t) => s + (t.status === 'created' ? t.creationCostSOL : 0), 0),
    totalRevenueSOL: launchedTokens.reduce((s, t) => s + (t.revenueSOL ?? 0), 0),
    nextLaunchWindow: CONFIG.peakHoursUTC.includes(new Date().getUTCHours()) ? 'NOW' : `Next peak hour: ${CONFIG.peakHoursUTC[0]}:00 UTC`,
    wallet: cachedWalletBalance ?? { sol: 0, usd: 0, address: process.env.PUMPPORTAL_WALLET ?? 'Not configured', updatedAt: '' },
  };
}

export function getTrends(): TrendCategory[] {
  return trendCache;
}

export function getAutoLaunched(): LaunchedToken[] {
  return [...launchedTokens];
}
