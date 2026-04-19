/**
 * Token Launch Coach Routes — APEX Coaching Module
 *
 * NOT a dashboard. A COACH that tells users what to do, when to do it,
 * and generates the content for them.
 *
 * User creates a coin, pastes the contract → APEX takes over.
 *
 * Endpoints:
 *   POST /api/v1/launch-coach/track        — Start tracking a token (paste contract)
 *   GET  /api/v1/launch-coach/status/:mint — Current coaching status + next action
 *   POST /api/v1/launch-coach/plan         — Pre-launch planning (concept → name/timing/tweets)
 *   GET  /api/v1/launch-coach/tracked      — All tracked tokens
 *   DELETE /api/v1/launch-coach/track/:mint — Stop tracking
 *   GET  /api/v1/launch-coach/revenue/:mint — Post-graduation revenue report
 */

import { Router, type Router as RouterType } from 'express';
import { logger } from '../lib/logger.js';
import {
  startTokenFactory, stopTokenFactory, getFactoryStatus, getTrends, getAutoLaunched,
} from '../services/token-factory/auto-launcher.js';
import {
  tweetMilestone, tweetGraduation, getTwitterStatus,
} from '../services/twitter-poster.js';

export const launchCoachRouter: RouterType = Router();

// ── Types ────────────────────────────────────────────────────────────────

interface TrackedToken {
  mint: string;
  name: string;
  ticker: string;
  createdAt: string;
  graduated: boolean;
  graduatedAt: string | null;
  bondingCurvePct: number;
  holders: number;
  buys: number;
  sells: number;
  buySellRatio: number;
  marketCapUsd: number;
  volumeUsd: number;
  lastBuyAt: string | null;
  minutesSinceLastBuy: number;
  smartMoneyBuyers: number;
  topWalletPct: number;
  graduationOdds: number;
  coachingStatus: 'monitoring' | 'stalled' | 'whale_alert' | 'almost_there' | 'graduated' | 'momentum_fading';
  nextAction: string;
  readyTweet: string | null;
  revenueSOL: number;
  revenueUSD: number;
  lastUpdated: string;
}

// ── Extended Types ──────────────────────────────────────────────────────

interface CoachingEvent {
  type: 'milestone' | 'stall' | 'whale' | 'smart_money' | 'graduation' | 'momentum_fade' | 'recovery';
  message: string;
  tweet: string | null;
  timestamp: string;
  urgent: boolean;
}

interface TweetCampaign {
  tweets: Array<{ text: string; occasion: string; postAt: string }>;
  generatedAt: string;
}

// ── State ────────────────────────────────────────────────────────────────

const trackedTokens = new Map<string, TrackedToken>();
const coachingHistory = new Map<string, CoachingEvent[]>(); // mint → event log
const milestonesFired = new Map<string, Set<number>>(); // mint → milestones already triggered
const tweetCampaigns = new Map<string, TweetCampaign>(); // mint → scheduled tweets
const CREATOR_FEE_RATE = 0.0095; // 0.95% of PumpSwap volume
const MILESTONES = [10, 25, 50, 75, 90, 95, 100]; // Bonding curve % milestones
const DEAD_COIN_MINUTES = 30; // No buys for 30 min = dead
let coachingInterval: ReturnType<typeof setInterval> | null = null;
let revenueInterval: ReturnType<typeof setInterval> | null = null;

// ── Persistence ─────────────────────────────────────────────────────────

import fs from 'fs';
import path from 'path';

const COACH_DATA_DIR = path.join(process.cwd(), '.coach-data');
try { if (!fs.existsSync(COACH_DATA_DIR)) fs.mkdirSync(COACH_DATA_DIR, { recursive: true }); } catch { /* */ }

function persistTrackedTokens(): void {
  try {
    const data: Record<string, TrackedToken> = {};
    for (const [mint, token] of trackedTokens) data[mint] = token;
    fs.writeFileSync(path.join(COACH_DATA_DIR, 'tracked-tokens.json'), JSON.stringify(data, null, 2));
  } catch { /* fire-and-forget */ }
}

function persistCoachingHistory(): void {
  try {
    const data: Record<string, CoachingEvent[]> = {};
    for (const [mint, events] of coachingHistory) data[mint] = events;
    fs.writeFileSync(path.join(COACH_DATA_DIR, 'coaching-history.json'), JSON.stringify(data, null, 2));
  } catch { /* fire-and-forget */ }
}

function loadPersistedCoachData(): void {
  try {
    const tokPath = path.join(COACH_DATA_DIR, 'tracked-tokens.json');
    if (fs.existsSync(tokPath)) {
      const raw = JSON.parse(fs.readFileSync(tokPath, 'utf-8')) as Record<string, TrackedToken>;
      for (const [mint, token] of Object.entries(raw)) {
        if (!trackedTokens.has(mint)) trackedTokens.set(mint, token);
      }
      if (trackedTokens.size > 0) {
        logger.info({ count: trackedTokens.size }, '[LaunchCoach] Loaded tracked tokens from disk');
        if (!coachingInterval) startCoachingLoop();
      }
    }
    const histPath = path.join(COACH_DATA_DIR, 'coaching-history.json');
    if (fs.existsSync(histPath)) {
      const raw = JSON.parse(fs.readFileSync(histPath, 'utf-8')) as Record<string, CoachingEvent[]>;
      for (const [mint, events] of Object.entries(raw)) {
        if (!coachingHistory.has(mint)) coachingHistory.set(mint, events);
      }
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[LaunchCoach] Failed to load persisted data');
  }
}

// Load on module init
loadPersistedCoachData();

// ── Token Analysis — Dual Source (PumpFun API + DexScreener) ─────────────

async function queryPumpFun(mint: string): Promise<{
  name: string; ticker: string; bondingCurvePct: number;
  marketCapSol: number; holders: number; buys: number; sells: number;
  vSolInBondingCurve: number; graduated: boolean;
} | null> {
  try {
    const res = await fetch(`https://frontend-api-v3.pump.fun/coins/${mint}`, {
      signal: AbortSignal.timeout(5_000),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json() as {
      name?: string; symbol?: string; market_cap_sol?: number;
      virtual_sol_reserves?: number; bonding_curve_progress?: number;
      total_supply?: number; holder_count?: number;
      buy_count?: number; sell_count?: number;
      migration_state?: string; raydium_pool?: string;
    };

    const curvePct = data.bonding_curve_progress ?? 0;
    const graduated = (data.migration_state === 'completed' || data.raydium_pool != null);

    return {
      name: data.name ?? mint.slice(0, 8),
      ticker: data.symbol ?? mint.slice(0, 4).toUpperCase(),
      bondingCurvePct: graduated ? 1.0 : curvePct,
      marketCapSol: data.market_cap_sol ?? 0,
      holders: data.holder_count ?? 0,
      buys: data.buy_count ?? 0,
      sells: data.sell_count ?? 0,
      vSolInBondingCurve: data.virtual_sol_reserves ?? 0,
      graduated,
    };
  } catch { return null; }
}

async function analyzeToken(mint: string): Promise<Partial<TrackedToken> | null> {
  // Source 1: PumpFun API (bonding curve data, holder count, buy/sell counts)
  const pf = await queryPumpFun(mint);

  // Source 2: DexScreener (price, volume, liquidity — better for graduated tokens)
  let dexVolume = 0;
  let dexLiquidity = 0;
  let dexMarketCap = 0;
  let dexName = '';
  let dexTicker = '';
  try {
    const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, { signal: AbortSignal.timeout(5_000) });
    if (dexRes.ok) {
      const dexData = await dexRes.json() as { pairs?: Array<{ baseToken: { symbol: string; name: string }; volume: { h24: number }; liquidity: { usd: number }; marketCap: number; fdv: number }> };
      const pair = dexData.pairs?.[0];
      if (pair) {
        dexVolume = pair.volume?.h24 ?? 0;
        dexLiquidity = pair.liquidity?.usd ?? 0;
        dexMarketCap = pair.marketCap ?? pair.fdv ?? 0;
        dexName = pair.baseToken.name;
        dexTicker = pair.baseToken.symbol;
      }
    }
  } catch { /* optional */ }

  if (!pf && !dexName) return null;

  const buys = pf?.buys ?? 0;
  const sells = pf?.sells ?? 0;
  const graduated = pf?.graduated ?? (dexLiquidity > 5_000);

  return {
    name: pf?.name ?? dexName ?? mint.slice(0, 8),
    ticker: pf?.ticker ?? dexTicker ?? mint.slice(0, 4).toUpperCase(),
    graduated,
    bondingCurvePct: pf?.bondingCurvePct ?? (graduated ? 1.0 : 0),
    holders: pf?.holders ?? buys,
    buys,
    sells,
    buySellRatio: sells > 0 ? buys / sells : buys > 0 ? 10 : 0,
    marketCapUsd: dexMarketCap || (pf?.marketCapSol ?? 0) * 80, // SOL ~$80
    volumeUsd: dexVolume,
  };
}

// ── Coaching Logic ───────────────────────────────────────────────────────

function determineCoachingStatus(token: TrackedToken): {
  status: TrackedToken['coachingStatus'];
  nextAction: string;
  tweet: string | null;
} {
  // GRADUATED
  if (token.graduated) {
    const dailyRevSOL = (token.volumeUsd * CREATOR_FEE_RATE) / 80; // SOL price ~$80
    return {
      status: 'graduated',
      nextAction: `🎓 GRADUATED! Your token is live on PumpSwap. You're earning ${dailyRevSOL.toFixed(2)} SOL/day from trading fees. Post a celebration tweet and keep the community active.`,
      tweet: `🎓 $${token.ticker} just GRADUATED to PumpSwap!\nLP burned. Community-driven.\nNow trading on PumpSwap with ${token.holders}+ traders.\nThis is just the beginning.`,
    };
  }

  // STALLED
  if (token.minutesSinceLastBuy > 15) {
    return {
      status: 'stalled',
      nextAction: `⚠️ No new buys in ${token.minutesSinceLastBuy} min! Post this tweet NOW and share in 2 new Telegram groups. Comment on your pump.fun token page.`,
      tweet: `$${token.ticker} bonding curve at ${(token.bondingCurvePct * 100).toFixed(0)}% and climbing 🔥\n${token.holders} holders and growing.\nDon't sleep on this one.\n[pump.fun link]`,
    };
  }

  // WHALE WARNING
  if (token.topWalletPct > 5) {
    return {
      status: 'whale_alert',
      nextAction: `🐋 Top wallet holds ${token.topWalletPct.toFixed(1)}%. Not fatal — focus on getting more diverse holders. Share the link wider to dilute.`,
      tweet: null,
    };
  }

  // ALMOST THERE
  if (token.bondingCurvePct > 0.75) {
    return {
      status: 'almost_there',
      nextAction: `🔥 ${(token.bondingCurvePct * 100).toFixed(0)}% curve! Push HARD on social. Graduation is close!`,
      tweet: `$${token.ticker} bonding curve at ${(token.bondingCurvePct * 100).toFixed(0)}%! 🔥\nAlmost graduating. ${token.holders} holders.\nThis dog is about to run.\n[pump.fun link]`,
    };
  }

  // MOMENTUM FADING
  if (token.buySellRatio < 2) {
    return {
      status: 'momentum_fading',
      nextAction: `📉 Buy/sell ratio dropping (${token.buySellRatio.toFixed(1)}:1). Post a fresh tweet to reignite interest.`,
      tweet: `$${token.ticker} still building. ${token.holders} holders.\nCurve at ${(token.bondingCurvePct * 100).toFixed(0)}%. Community is here to stay.\nNow's your chance to be early.\n[pump.fun link]`,
    };
  }

  // HEALTHY
  return {
    status: 'monitoring',
    nextAction: `✅ Momentum good (${token.buySellRatio.toFixed(1)}:1 buy/sell). ${token.holders} holders. Keep posting every 30 min.`,
    tweet: null,
  };
}

// ── Milestone Detection ──────────────────────────────────────────────────

function checkMilestones(mint: string, token: TrackedToken): void {
  const fired = milestonesFired.get(mint) ?? new Set<number>();
  const curvePct = Math.round(token.bondingCurvePct * 100);

  for (const ms of MILESTONES) {
    if (curvePct >= ms && !fired.has(ms)) {
      fired.add(ms);
      const event: CoachingEvent = {
        type: 'milestone',
        message: ms === 100
          ? `🎓 GRADUATED! Bonding curve 100%. Token migrated to PumpSwap. You now earn 0.95% of ALL trading volume!`
          : `🎯 Milestone: Bonding curve hit ${ms}%! ${100 - ms}% to graduation.`,
        tweet: ms === 100
          ? `🎓 $${token.ticker} just GRADUATED to PumpSwap!\nLP burned. Community-driven. We made it.\nNow trading on PumpSwap.\n0.95% creator revenue is LIVE.`
          : ms >= 75
          ? `$${token.ticker} bonding curve at ${ms}%! 🔥\nGraduation is RIGHT THERE. Don't miss this.\n[pump.fun link]`
          : `$${token.ticker} just hit ${ms}% bonding curve! ${token.holders} holders.\nMomentum building. LFG!\n[pump.fun link]`,
        timestamp: new Date().toISOString(),
        urgent: ms >= 90,
      };

      const history = coachingHistory.get(mint) ?? [];
      history.push(event);
      if (history.length > 50) history.shift();
      coachingHistory.set(mint, history);

      logger.info({ mint, ticker: token.ticker, milestone: ms }, `[LaunchCoach] Milestone ${ms}% for $${token.ticker}`);

      // Auto-tweet at key milestones (75%, 90%, graduation)
      if (ms >= 75) {
        void (async () => {
          try {
            if (ms === 100) {
              await tweetGraduation(token.ticker, mint);
            } else {
              await tweetMilestone(token.ticker, ms, token.holders, mint);
            }
          } catch { /* twitter not configured */ }
        })();
      }
    }
  }
  milestonesFired.set(mint, fired);
}

// ── Graduation Playbook ──────────────────────────────────────────────────

function generateGraduationPlaybook(token: TrackedToken): string {
  return [
    `🎓🎓🎓 $${token.ticker} GRADUATED! 🎓🎓🎓`,
    ``,
    `LP burned. You now earn 0.95% of ALL trading volume.`,
    ``,
    `THE NEXT 30 MINUTES DECIDE EVERYTHING:`,
    ``,
    `MINUTE 0-2:`,
    `1. POST THIS TWEET IMMEDIATELY (copy below)`,
    `2. Post in Telegram: "WE GRADUATED! Trading live on PumpSwap now."`,
    ``,
    `MINUTE 2-5:`,
    `3. Check DexScreener — is $${token.ticker} showing up?`,
    `4. Respond to EVERY comment on pump.fun`,
    ``,
    `MINUTE 5-15:`,
    `5. Consider adding liquidity to PumpSwap pool`,
    `   More liquidity = less slippage = more traders`,
    ``,
    `MINUTE 10-30:`,
    `6. Share holder count milestones on Twitter`,
    `7. Engage new holders — every response matters`,
    ``,
    `Revenue tracking is now active. Updates every 5 min.`,
  ].join('\n');
}

// ── Tweet Campaign Generator ─────────────────────────────────────────────

function generateTweetCampaign(token: TrackedToken): TweetCampaign {
  const ticker = token.ticker;
  const now = Date.now();
  const tweets = [
    { text: `$${ticker} just launched on @pumpdotfun 🔥\nThis is just the beginning. Who's early?\n[pump.fun link]`, occasion: 'launch', postAt: new Date(now).toISOString() },
    { text: `$${ticker} already growing. ${token.holders} holders in.\nThe community is building. Are you?\n[pump.fun link]`, occasion: 'early_traction', postAt: new Date(now + 10 * 60_000).toISOString() },
    { text: `Bonding curve moving on $${ticker} 📈\nStill early. Still building.\n[pump.fun link]`, occasion: 'momentum', postAt: new Date(now + 30 * 60_000).toISOString() },
    { text: `$${ticker} update: ${token.holders}+ holders and counting.\nThe curve doesn't lie. Momentum is real.\n[pump.fun link]`, occasion: 'milestone', postAt: new Date(now + 60 * 60_000).toISOString() },
    { text: `Why $${ticker}? Simple.\nCommunity-driven. No VC. No insider allocations.\nJust builders and believers.\n[pump.fun link]`, occasion: 'narrative', postAt: new Date(now + 2 * 3600_000).toISOString() },
    { text: `$${ticker} is not a sprint. It's a marathon.\nEvery holder matters. Every share counts.\nLet's graduate this together.\n[pump.fun link]`, occasion: 'grind', postAt: new Date(now + 4 * 3600_000).toISOString() },
    { text: `Late night $${ticker} update:\nStill here. Still building. Still growing.\nThe community never sleeps.\n[pump.fun link]`, occasion: 'night', postAt: new Date(now + 8 * 3600_000).toISOString() },
    { text: `Good morning $${ticker} fam!\nAnother day, another push toward graduation.\nWho's buying the dip?\n[pump.fun link]`, occasion: 'morning', postAt: new Date(now + 16 * 3600_000).toISOString() },
  ];

  return { tweets, generatedAt: new Date().toISOString() };
}

// ── Coaching Loop (10s for active, 30s otherwise) ────────────────────────

async function runCoachingCycle(): Promise<void> {
  for (const [mint, token] of trackedTokens) {
    try {
      const prevGraduated = token.graduated;
      const prevBuys = token.buys;

      // Fetch latest data
      const analysis = await analyzeToken(mint);
      if (!analysis) continue;

      // Update token data
      Object.assign(token, analysis);
      token.lastUpdated = new Date().toISOString();

      // Track last buy time
      if ((analysis.buys ?? 0) > prevBuys) {
        token.lastBuyAt = new Date().toISOString();
        token.minutesSinceLastBuy = 0;
      } else if (token.lastBuyAt) {
        token.minutesSinceLastBuy = (Date.now() - new Date(token.lastBuyAt).getTime()) / 60_000;
      } else {
        token.minutesSinceLastBuy = (Date.now() - new Date(token.createdAt).getTime()) / 60_000;
      }

      // Revenue for graduated tokens
      if (token.graduated) {
        token.revenueSOL = (token.volumeUsd * CREATOR_FEE_RATE) / 80;
        token.revenueUSD = token.volumeUsd * CREATOR_FEE_RATE;
        if (!token.graduatedAt) {
          token.graduatedAt = new Date().toISOString();
          // First graduation detection — fire playbook
          if (!prevGraduated) {
            token.nextAction = generateGraduationPlaybook(token);
            token.readyTweet = `🎓 $${token.ticker} just GRADUATED to PumpSwap!\nLP burned. Community-driven. We made it.\nCreator revenue is LIVE. 0.95% of all volume.\nThis is just the beginning.`;
            token.coachingStatus = 'graduated';

            const history = coachingHistory.get(mint) ?? [];
            history.push({
              type: 'graduation',
              message: token.nextAction,
              tweet: token.readyTweet,
              timestamp: new Date().toISOString(),
              urgent: true,
            });
            coachingHistory.set(mint, history);

            logger.info({ mint, ticker: token.ticker }, `[LaunchCoach] 🎓 $${token.ticker} GRADUATED!`);
            continue; // Skip normal coaching — graduation playbook takes priority
          }
        }
      }

      // Graduation odds
      if (!token.graduated) {
        const baseOdds = 0.014;
        const ratioBoost = Math.min(token.buySellRatio / 5, 3);
        const curveBoost = 1 + token.bondingCurvePct * 5;
        const holderBoost = Math.min(token.holders / 100, 2);
        token.graduationOdds = Math.min(baseOdds * ratioBoost * curveBoost * holderBoost * 100, 95);
      }

      // Check milestones
      checkMilestones(mint, token);

      // Generate tweet campaign if not already done
      if (!tweetCampaigns.has(mint)) {
        tweetCampaigns.set(mint, generateTweetCampaign(token));
      }

      // Determine coaching status + next action
      const coaching = determineCoachingStatus(token);
      token.coachingStatus = coaching.status;
      token.nextAction = coaching.nextAction;
      token.readyTweet = coaching.tweet;

      // Log coaching events for stall/whale/momentum changes
      if (coaching.status === 'stalled' || coaching.status === 'whale_alert' || coaching.status === 'momentum_fading') {
        const history = coachingHistory.get(mint) ?? [];
        const lastEvent = history[history.length - 1];
        // Don't spam same event type within 5 min
        const mappedType = coaching.status === 'stalled' ? 'stall' : coaching.status === 'whale_alert' ? 'whale' : 'momentum_fade';
        if (!lastEvent || lastEvent.type !== mappedType || Date.now() - new Date(lastEvent.timestamp).getTime() > 300_000) {
          history.push({
            type: coaching.status === 'stalled' ? 'stall' : coaching.status === 'whale_alert' ? 'whale' : 'momentum_fade',
            message: coaching.nextAction,
            tweet: coaching.tweet,
            timestamp: new Date().toISOString(),
            urgent: coaching.status === 'stalled',
          });
          if (history.length > 50) history.shift();
          coachingHistory.set(mint, history);
        }
      }

      // ── Dead coin detection: no buys for 30 min = dead ──
      if (!token.graduated && token.minutesSinceLastBuy > DEAD_COIN_MINUTES && token.buys > 0) {
        token.coachingStatus = 'stalled';
        token.nextAction = `DEAD COIN: No buys for ${Math.round(token.minutesSinceLastBuy)} min. Consider cutting losses. Bonding curve at ${(token.bondingCurvePct * 100).toFixed(0)}%.`;

        const history = coachingHistory.get(mint) ?? [];
        const lastDead = history.find(e => e.type === 'stall' && e.message.includes('DEAD COIN'));
        if (!lastDead) {
          history.push({
            type: 'stall',
            message: token.nextAction,
            tweet: null,
            timestamp: new Date().toISOString(),
            urgent: true,
          });
          coachingHistory.set(mint, history);
          logger.warn({ mint, ticker: token.ticker, minsSinceLastBuy: Math.round(token.minutesSinceLastBuy) },
            `[LaunchCoach] DEAD COIN: $${token.ticker} — no buys for ${Math.round(token.minutesSinceLastBuy)} min`);
        }
      }

    } catch (err) {
      logger.warn({ mint, err: err instanceof Error ? err.message : err }, '[LaunchCoach] Analysis failed');
    }
  }

  // Persist state after each cycle
  persistTrackedTokens();
  persistCoachingHistory();
}

export function startCoachingLoop(): void {
  if (coachingInterval) return;
  // 15-second cycle for active coaching (faster than 30s for real-time feel)
  coachingInterval = setInterval(runCoachingCycle, 15_000);
  logger.info('[LaunchCoach] Coaching loop started (15s cycle)');
}

export function stopCoachingLoop(): void {
  if (coachingInterval) { clearInterval(coachingInterval); coachingInterval = null; }
  if (revenueInterval) { clearInterval(revenueInterval); revenueInterval = null; }
}

// ── Routes ───────────────────────────────────────────────────────────────

// POST /track — Start tracking a token
launchCoachRouter.post('/track', async (req, res) => {
  const { mint } = req.body as { mint?: string };
  if (!mint || mint.length < 30) {
    res.status(400).json({ error: 'Invalid mint address' });
    return;
  }

  if (trackedTokens.has(mint)) {
    res.json({ data: trackedTokens.get(mint), message: 'Already tracking' });
    return;
  }

  // Initial analysis
  const analysis = await analyzeToken(mint);

  const token: TrackedToken = {
    mint,
    name: analysis?.name ?? mint.slice(0, 8),
    ticker: analysis?.ticker ?? mint.slice(0, 4).toUpperCase(),
    createdAt: new Date().toISOString(),
    graduated: analysis?.graduated ?? false,
    graduatedAt: null,
    bondingCurvePct: analysis?.bondingCurvePct ?? 0,
    holders: analysis?.holders ?? 0,
    buys: analysis?.buys ?? 0,
    sells: analysis?.sells ?? 0,
    buySellRatio: analysis?.buySellRatio ?? 0,
    marketCapUsd: analysis?.marketCapUsd ?? 0,
    volumeUsd: analysis?.volumeUsd ?? 0,
    lastBuyAt: null,
    minutesSinceLastBuy: 0,
    smartMoneyBuyers: 0,
    topWalletPct: 0,
    graduationOdds: 1.4,
    coachingStatus: 'monitoring',
    nextAction: 'Token tracked! Analyzing...',
    readyTweet: null,
    revenueSOL: 0,
    revenueUSD: 0,
    lastUpdated: new Date().toISOString(),
  };

  // Generate initial coaching
  const coaching = determineCoachingStatus(token);
  token.coachingStatus = coaching.status;
  token.nextAction = coaching.nextAction;
  token.readyTweet = coaching.tweet;

  trackedTokens.set(mint, token);
  persistTrackedTokens();

  // Start coaching loop if not running
  if (!coachingInterval) startCoachingLoop();

  logger.info({ mint, name: token.name, ticker: token.ticker }, `[LaunchCoach] Now tracking $${token.ticker}`);

  res.json({ data: token });
});

// ── Auto-track function (called by Token Factory after launch) ──
export function autoTrackToken(mint: string, name: string, ticker: string): void {
  if (trackedTokens.has(mint)) return;

  const token: TrackedToken = {
    mint, name, ticker,
    createdAt: new Date().toISOString(),
    graduated: false, graduatedAt: null,
    bondingCurvePct: 0, holders: 0,
    buys: 0, sells: 0, buySellRatio: 0,
    marketCapUsd: 0, volumeUsd: 0,
    lastBuyAt: null, minutesSinceLastBuy: 0,
    smartMoneyBuyers: 0, topWalletPct: 0,
    graduationOdds: 1.4,
    coachingStatus: 'monitoring',
    nextAction: `Token launched! Coaching active. Post the launch tweet and share in Telegram.`,
    readyTweet: `$${ticker} just launched on pump.fun!\n${name}\nWho's early? LFG!\nhttps://pump.fun/coin/${mint}`,
    revenueSOL: 0, revenueUSD: 0,
    lastUpdated: new Date().toISOString(),
  };

  trackedTokens.set(mint, token);
  persistTrackedTokens();
  if (!coachingInterval) startCoachingLoop();
  logger.info({ mint, ticker }, `[LaunchCoach] Auto-tracked $${ticker} from Token Factory`);
}

// GET /status/:mint — Current status + next action
launchCoachRouter.get('/status/:mint', (_req, res) => {
  const token = trackedTokens.get(_req.params.mint);
  if (!token) {
    res.status(404).json({ error: 'Token not tracked. POST /track with the mint address first.' });
    return;
  }
  res.json({ data: token });
});

// GET /tracked — All tracked tokens
launchCoachRouter.get('/tracked', (_req, res) => {
  res.json({
    data: [...trackedTokens.values()],
    count: trackedTokens.size,
    coachingActive: coachingInterval !== null,
  });
});

// DELETE /track/:mint — Stop tracking
launchCoachRouter.delete('/track/:mint', (_req, res) => {
  const deleted = trackedTokens.delete(_req.params.mint);
  persistTrackedTokens();
  if (trackedTokens.size === 0 && coachingInterval) {
    stopCoachingLoop();
  }
  res.json({ deleted, remaining: trackedTokens.size });
});

// GET /revenue/:mint — Revenue report for graduated token
launchCoachRouter.get('/revenue/:mint', (_req, res) => {
  const token = trackedTokens.get(_req.params.mint);
  if (!token) {
    res.status(404).json({ error: 'Token not tracked' });
    return;
  }
  if (!token.graduated) {
    res.json({ data: { graduated: false, message: 'Token has not graduated yet. Revenue tracking starts after graduation.' } });
    return;
  }

  res.json({
    data: {
      mint: token.mint,
      ticker: token.ticker,
      graduated: true,
      graduatedAt: token.graduatedAt,
      volume24hUsd: token.volumeUsd,
      revenue24hSOL: Math.round(token.revenueSOL * 10000) / 10000,
      revenue24hUSD: Math.round(token.revenueUSD * 100) / 100,
      projectedMonthlySOL: Math.round(token.revenueSOL * 30 * 100) / 100,
      projectedMonthlyUSD: Math.round(token.revenueUSD * 30 * 100) / 100,
      cashoutInstructions: [
        'SOL is in your creator wallet automatically',
        'Go to jup.ag (Jupiter) → Swap SOL to USDC',
        'Send USDC to Coinbase or Kraken',
        'Withdraw to your bank account',
      ],
    },
  });
});

// POST /plan — Pre-launch planning
launchCoachRouter.post('/plan', async (req, res) => {
  const { concept } = req.body as { concept?: string };
  if (!concept) {
    res.status(400).json({ error: 'Provide a concept (e.g., "dog-themed meme coin")' });
    return;
  }

  // Category detection + saturation check
  const categories = ['animal', 'political', 'celebrity', 'ai', 'gaming', 'defi', 'culture', 'meme', 'food', 'sport'];
  const conceptLower = concept.toLowerCase();
  let category = 'meme';
  for (const cat of categories) {
    if (conceptLower.includes(cat)) { category = cat; break; }
  }
  // Detect animal subcategories
  if (/dog|puppy|pup|shiba|doge|woof|bark/i.test(conceptLower)) category = 'animal/dog';
  if (/cat|kitten|meow|kitty/i.test(conceptLower)) category = 'animal/cat';
  if (/frog|pepe|toad/i.test(conceptLower)) category = 'animal/frog';

  // Generate name suggestions
  const nameBase = concept.replace(/[^a-zA-Z0-9 ]/g, '').trim();
  const words = nameBase.split(/\s+/);
  const suggestions = [
    { name: words[0]?.toUpperCase() + 'COIN', ticker: words[0]?.slice(0, 4).toUpperCase() ?? 'MEME', hook: `The ${concept} of Solana` },
    { name: words.map(w => w[0]?.toUpperCase()).join('') + 'INU', ticker: words.map(w => w[0]).join('').toUpperCase(), hook: `${concept} meets blockchain` },
    { name: nameBase.replace(/\s+/g, '').toUpperCase(), ticker: nameBase.replace(/\s+/g, '').slice(0, 5).toUpperCase(), hook: `Built different. ${concept}.` },
  ];

  res.json({
    data: {
      concept,
      category,
      saturation: 'medium', // Would need real pump.fun data
      recommendation: 'LAUNCH',
      timing: {
        bestWindow: 'Tuesday-Thursday, 10:00 AM - 2:00 PM ET',
        avoid: 'Sunday before noon, Friday after 4 PM',
        reason: 'Peak pump.fun activity = maximum organic discovery',
      },
      nameOptions: suggestions,
      preLaunchChecklist: [
        `Create Twitter account for ${suggestions[0].name}`,
        'Create Telegram group',
        'Design logo/image',
        `Launch at optimal window`,
        'Have 3 tweets ready to fire (paste contract here after launch)',
      ],
      readyTweets: [
        `$${suggestions[0].ticker} just launched on @pumpdotfun 🔥\n${suggestions[0].hook}\nWho's in? LFG!\n[pump.fun link]`,
        `$${suggestions[0].ticker} already growing! Early holders are in.\nBonding curve moving. Don't sleep.\n[pump.fun link]`,
        `$${suggestions[0].ticker} community is building 🚀\nThis is just the beginning.\n[pump.fun link]`,
      ],
    },
  });
});

// GET /history/:mint — Coaching event history (milestones, stalls, alerts)
launchCoachRouter.get('/history/:mint', (_req, res) => {
  const history = coachingHistory.get(_req.params.mint) ?? [];
  res.json({ data: history, count: history.length });
});

// GET /tweets/:mint — Tweet campaign (8 tweets across 24 hours)
launchCoachRouter.get('/tweets/:mint', (_req, res) => {
  const token = trackedTokens.get(_req.params.mint);
  if (!token) { res.status(404).json({ error: 'Token not tracked' }); return; }

  let campaign = tweetCampaigns.get(_req.params.mint);
  if (!campaign) {
    campaign = generateTweetCampaign(token);
    tweetCampaigns.set(_req.params.mint, campaign);
  }
  res.json({ data: campaign });
});

// POST /tweets/:mint/regenerate — Regenerate tweet campaign with latest data
launchCoachRouter.post('/tweets/:mint/regenerate', (_req, res) => {
  const token = trackedTokens.get(_req.params.mint);
  if (!token) { res.status(404).json({ error: 'Token not tracked' }); return; }

  const campaign = generateTweetCampaign(token);
  tweetCampaigns.set(_req.params.mint, campaign);
  res.json({ data: campaign });
});

// GET /playbook/:mint — Graduation playbook (30-min post-graduation checklist)
launchCoachRouter.get('/playbook/:mint', (_req, res) => {
  const token = trackedTokens.get(_req.params.mint);
  if (!token) { res.status(404).json({ error: 'Token not tracked' }); return; }
  if (!token.graduated) { res.json({ data: { graduated: false, message: 'Token has not graduated yet.' } }); return; }

  res.json({
    data: {
      graduated: true,
      playbook: generateGraduationPlaybook(token),
      readyTweet: `🎓 $${token.ticker} just GRADUATED to PumpSwap!\nLP burned. Community-driven. We made it.\nCreator revenue is LIVE.\nThis is just the beginning.`,
      telegramMessage: `WE GRADUATED! 🎓 $${token.ticker} is now trading on PumpSwap. LP burned. Creator revenue active.`,
      pumpFunComment: `🎓 GRADUATED! $${token.ticker} made it to PumpSwap. LP burned. Let's keep building!`,
    },
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ██  TOKEN FACTORY — Auto-Launch Pipeline                               ██
// ══════════════════════════════════════════════════════════════════════════

// GET /factory/status — Auto-launcher status + trend data
launchCoachRouter.get('/factory/status', async (_req, res) => {
  res.json({ data: await getFactoryStatus() });
});

// GET /factory/trends — Current category trends + opportunity scores
launchCoachRouter.get('/factory/trends', (_req, res) => {
  res.json({ data: getTrends() });
});

// GET /factory/launched — All auto-launched tokens
launchCoachRouter.get('/factory/launched', (_req, res) => {
  res.json({ data: getAutoLaunched() });
});

// POST /factory/start — Start the auto-launcher
launchCoachRouter.post('/factory/start', (_req, res) => {
  startTokenFactory();
  res.json({ message: 'Token factory started — auto-launching during peak hours' });
});

// POST /factory/stop — Stop the auto-launcher
launchCoachRouter.post('/factory/stop', (_req, res) => {
  stopTokenFactory();
  res.json({ message: 'Token factory stopped' });
});

// POST /factory/launch-now — Force immediate launch (skip peak hours check)
launchCoachRouter.post('/factory/launch-now', async (_req, res) => {
  try {
    const { forceAutoLaunch } = await import('../services/token-factory/auto-launcher.js');
    const result = await forceAutoLaunch();
    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Launch failed' });
  }
});

// GET /twitter/status — Twitter posting status + remaining budget
launchCoachRouter.get('/twitter/status', (_req, res) => {
  res.json({ data: getTwitterStatus() });
});
