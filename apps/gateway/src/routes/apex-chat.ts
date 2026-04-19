/**
 * APEX Chat — Conversational AI Trading Assistant
 *
 * Chat with the APEX agent about your portfolio, markets, strategies,
 * and trade analysis. Uses Gemini Flash (free) with full trading context.
 *
 * POST /api/v1/apex/chat    — Send message, get response
 * GET  /api/v1/apex/context  — Get current trading context (debug)
 */

import { Router, type Router as RouterType } from 'express';
import express from 'express';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getMacroRegime } from '../services/ai/macro-regime.js';
import {
  sniperTemplates,
  executionHistory,
  getRuntime,
  getTemplatePositions,
  cachedSolBalanceLamports,
} from './solana-sniper/state.js';
import { logger } from '../lib/logger.js';

export const apexChatRouter: RouterType = Router();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY ?? '';

// ── Multi-Model Analysis Engine ──────────────────────────────────────────

interface ModelAnalysis {
  model: string;
  reply: string;
  latencyMs: number;
  error?: string;
}

/** Call OpenAI GPT-4o for analysis */
async function callOpenAI(systemPrompt: string, userMessage: string, imageBase64?: string, imageMime?: string): Promise<ModelAnalysis> {
  if (!OPENAI_API_KEY) return { model: 'gpt-4o', reply: '', latencyMs: 0, error: 'No API key' };
  const start = Date.now();
  try {
    const messages: Array<{ role: string; content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> }> = [
      { role: 'system', content: systemPrompt },
    ];

    if (imageBase64 && imageMime) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: userMessage || 'Analyze this chart' },
          { type: 'image_url', image_url: { url: `data:${imageMime};base64,${imageBase64}` } },
        ],
      });
    } else {
      messages.push({ role: 'user', content: userMessage });
    }

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages,
        max_tokens: 3000,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(45_000),
    });

    if (!res.ok) {
      return { model: 'gpt-4o', reply: '', latencyMs: Date.now() - start, error: `HTTP ${res.status}` };
    }
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    return {
      model: 'gpt-4o',
      reply: data.choices?.[0]?.message?.content ?? '',
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return { model: 'gpt-4o', reply: '', latencyMs: Date.now() - start, error: err instanceof Error ? err.message : 'Failed' };
  }
}

/** Call DeepSeek for analysis */
async function callDeepSeek(systemPrompt: string, userMessage: string): Promise<ModelAnalysis> {
  if (!DEEPSEEK_API_KEY) return { model: 'deepseek', reply: '', latencyMs: 0, error: 'No API key' };
  const start = Date.now();
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 3000,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(45_000),
    });

    if (!res.ok) {
      return { model: 'deepseek', reply: '', latencyMs: Date.now() - start, error: `HTTP ${res.status}` };
    }
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    return {
      model: 'deepseek',
      reply: data.choices?.[0]?.message?.content ?? '',
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return { model: 'deepseek', reply: '', latencyMs: Date.now() - start, error: err instanceof Error ? err.message : 'Failed' };
  }
}

/** Synthesize multiple model analyses into a unified response */
async function synthesizeAnalyses(
  primary: string,
  analyses: ModelAnalysis[],
  systemPrompt: string,
): Promise<string> {
  const validAnalyses = analyses.filter(a => a.reply.length > 50);
  if (validAnalyses.length === 0) return primary; // Only Gemini responded

  const synthesisPrompt = `You are APEX. You just received analysis from ${validAnalyses.length + 1} different AI models on the same request. Your job is to synthesize the BEST insights from all of them into one unified, actionable response.

YOUR primary analysis (Gemini):
${primary}

${validAnalyses.map(a => `--- ${a.model.toUpperCase()} ANALYSIS (${a.latencyMs}ms) ---\n${a.reply}`).join('\n\n')}

SYNTHESIS RULES:
1. Lead with the CONSENSUS — what do all models agree on?
2. Highlight any DISAGREEMENTS between models — these are where alpha lives
3. If one model found something the others missed, include it
4. Use the most specific price levels from whichever model provided them
5. Keep the APEX TRADE PROMPT format for the final recommendation
6. At the end, note which models contributed: "Analysis powered by: Gemini, GPT-4o, DeepSeek"
7. Be concise — don't repeat the same point from different models`;

  try {
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: synthesisPrompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.5, maxOutputTokens: 8192, topP: 0.9 },
      }),
      signal: AbortSignal.timeout(45_000),
    });

    if (!res.ok) return primary + '\n\n---\n*Multi-model synthesis unavailable*';
    const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? primary;
  } catch {
    return primary + '\n\n---\n*Multi-model synthesis unavailable*';
  }
}

/** Check if the request warrants multi-model analysis (analyze commands, not casual chat) */
function shouldUseMultiModel(command: string | null): boolean {
  return command === 'analyze' || command === 'image-analyze' || command === 'risk' || command === 'brief';
}

// Load APEX system prompt from file at startup
let APEX_IDENTITY = '';
try {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const promptPath = resolve(thisDir, '../services/apex/APEX-SYSTEM.md');
  APEX_IDENTITY = readFileSync(promptPath, 'utf-8');
  console.log(`[APEX] Loaded system prompt (${APEX_IDENTITY.length} chars)`);
} catch {
  // Fallback if file not found (e.g. running from dist/)
  try {
    APEX_IDENTITY = readFileSync(resolve(process.cwd(), 'src/services/apex/APEX-SYSTEM.md'), 'utf-8');
  } catch {
    APEX_IDENTITY = 'You are APEX, an elite autonomous financial intelligence system built by Strange Digital Group.';
    console.warn('[APEX] System prompt file not found — using minimal fallback');
  }
}

// ── Context Builder ──────────────────────────────────────────────────────

interface LivePrices {
  [symbol: string]: { price: number; change24h: number };
}

interface TradingContext {
  regime: string;
  regimeSummary: string;
  walletSol: number;
  totalTrades: number;
  winRate: number;
  totalPnlSol: number;
  activeStrategies: string[];
  openPositions: Array<{ symbol: string; pnlPercent: number; strategy: string }>;
  recentTrades: Array<{ symbol: string; pnl: number; trigger: string; time: string }>;
  exitBreakdown: Record<string, number>;
  prices: LivePrices;
}

// ── Live Price Fetching ──────────────────────────────────────────────────

let priceCache: LivePrices = {};
let priceCacheAt = 0;
const PRICE_CACHE_TTL = 60_000; // 1 min

async function fetchLivePrices(): Promise<LivePrices> {
  if (Date.now() - priceCacheAt < PRICE_CACHE_TTL && Object.keys(priceCache).length > 0) {
    return priceCache;
  }

  const prices: LivePrices = {};
  try {
    // CoinGecko free API — no key needed, 30 req/min
    const ids = 'bitcoin,ethereum,solana,avalanche-2,chainlink,dogecoin,cardano,polkadot,near,sui';
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (res.ok) {
      const data = await res.json() as Record<string, { usd: number; usd_24h_change: number }>;
      const nameMap: Record<string, string> = {
        bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', 'avalanche-2': 'AVAX',
        chainlink: 'LINK', dogecoin: 'DOGE', cardano: 'ADA', polkadot: 'DOT',
        near: 'NEAR', sui: 'SUI',
      };
      for (const [id, info] of Object.entries(data)) {
        const symbol = nameMap[id] ?? id.toUpperCase();
        prices[symbol] = { price: info.usd, change24h: info.usd_24h_change ?? 0 };
      }
    }
  } catch {
    // Fallback: Coinbase spot prices for top assets
    try {
      for (const sym of ['BTC', 'ETH', 'SOL']) {
        const r = await fetch(`https://api.coinbase.com/v2/prices/${sym}-USD/spot`, {
          signal: AbortSignal.timeout(5_000),
        });
        if (r.ok) {
          const d = await r.json() as { data: { amount: string } };
          prices[sym] = { price: parseFloat(d.data.amount), change24h: 0 };
        }
      }
    } catch { /* silent */ }
  }

  priceCache = prices;
  priceCacheAt = Date.now();
  return prices;
}

async function buildTradingContext(): Promise<TradingContext> {
  let regime = 'unknown';
  let regimeSummary = '';
  try {
    const r = await getMacroRegime();
    regime = r.regime;
    regimeSummary = r.summary;
  } catch { /* non-critical */ }

  const walletSol = cachedSolBalanceLamports / 1e9;

  // Aggregate stats
  let totalTrades = 0;
  let wins = 0;
  let totalPnlSol = 0;
  const activeStrategies: string[] = [];

  for (const [id, tpl] of sniperTemplates) {
    totalTrades += tpl.stats.totalTrades;
    wins += tpl.stats.wins;
    totalPnlSol += tpl.stats.totalPnlSol;
    if (tpl.enabled) {
      const runtime = getRuntime(id);
      activeStrategies.push(`${tpl.name} (${tpl.paperMode ? 'paper' : 'live'}, ${runtime.running ? 'running' : 'stopped'})`);
    }
  }

  const winRate = totalTrades > 0 ? Math.round((wins / totalTrades) * 100) : 0;

  // Open positions
  const openPositions: TradingContext['openPositions'] = [];
  for (const [, tpl] of sniperTemplates) {
    const positions = getTemplatePositions(tpl.id);
    for (const [, pos] of positions) {
      openPositions.push({
        symbol: pos.symbol,
        pnlPercent: pos.pnlPercent,
        strategy: tpl.name,
      });
    }
  }

  // Recent trades (last 20 sells)
  const recentSells = executionHistory
    .filter(e => e.action === 'sell' && e.trigger)
    .slice(-20)
    .map(e => ({
      symbol: e.symbol,
      pnl: e.pnlSol ?? 0,
      trigger: e.trigger ?? 'unknown',
      time: e.timestamp,
    }));

  // Exit type breakdown
  const exitBreakdown: Record<string, number> = {};
  for (const e of executionHistory) {
    if (e.action === 'sell' && e.trigger) {
      exitBreakdown[e.trigger] = (exitBreakdown[e.trigger] ?? 0) + 1;
    }
  }

  // Fetch live prices
  const prices = await fetchLivePrices();

  return {
    regime,
    regimeSummary,
    walletSol,
    totalTrades,
    winRate,
    totalPnlSol,
    activeStrategies,
    openPositions,
    recentTrades: recentSells,
    exitBreakdown,
    prices,
  };
}

function detectCommand(message: string, hasFiles = false): string | null {
  const lower = message.toLowerCase().trim();
  // Image analysis takes priority when files are attached
  if (hasFiles && (lower.includes('analyze') || lower.includes('analysis') || lower.includes('this stock') || lower.includes('this chart') || lower.includes('this token') || lower.includes('what do you see') || lower.includes('look at'))) {
    return 'image-analyze';
  }
  // If files are attached with no specific command, still default to image analysis
  if (hasFiles && lower.length < 50) return 'image-analyze';
  if (lower.includes('analyze') || lower.includes('analysis')) return 'analyze';
  if (lower.includes('scan moonshot') || lower.includes('scan token') || lower.includes('score token')) return 'moonshot';
  if (lower.includes('risk check') || lower.includes('risk audit') || lower.includes('risk report')) return 'risk';
  if (lower.includes('income audit') || lower.includes('income stream') || lower.includes('revenue')) return 'income';
  if (lower.includes('morning brief') || lower.includes('briefing') || lower.includes('opportunities')) return 'brief';
  if (lower.includes('debrief') || lower.includes('review performance') || lower.includes('what went wrong')) return 'debrief';
  return null;
}

function getCommandContext(command: string | null): string {
  if (!command) return '';
  const skills: Record<string, string> = {
    analyze: `\n\nACTIVATED SKILL: Trade Analyzer
When analyzing a ticker/token, work through: (1) Overview — price, market cap, sector (2) Technical Analysis — RSI, MACD, EMA alignment, volume, support/resistance (3) Sentiment — social momentum, news (4) Risk Assessment — max loss scenario, correlation to portfolio (5) Trade Thesis — entry, stop, target, R:R ratio, position size per risk rules. Be specific with numbers.`,
    moonshot: `\n\nACTIVATED SKILL: Moonshot Scanner
Score tokens 0-100: holder_velocity(25%) + lp_depth(20%) + dev_wallet(20%) + social_signal(15%) + contract_audit(10%) + age(10%). HARD VETO if: dev wallet >15%, LP not locked, top 3 wallets >50%, known rug deployer. Position sizing: never >2% of crypto portfolio on any moonshot.`,
    risk: `\n\nACTIVATED SKILL: Risk Manager
Run full risk audit: (1) Daily risk budget = 2% of portfolio. Calculate remaining budget. (2) Check position correlations — no >30% in same sector. (3) Verify all positions have stops. (4) Check drawdown — if >10% in 30 days, recommend pausing new entries. (5) Emergency cash reserve check — maintain 20% in stablecoins. The Risk Manager has VETO POWER.`,
    income: `\n\nACTIVATED SKILL: Income Audit
Map all income streams: Trading capital yield, SaaS MRR (PulsIQ, TradeWorks), AI agent builds, automation retainers, real estate cash flow. For each: current monthly revenue, time required, scalability (1-10), trend. Calculate gap to targets. Identify highest-ROI next action.`,
    brief: `\n\nACTIVATED SKILL: Morning Brief
Compile top 5 opportunities across all markets. For each: asset, thesis, entry, target, risk, timeframe. Include macro regime context and any overnight developments. Prioritize by risk-adjusted expected value.`,
    debrief: `\n\nACTIVATED SKILL: Performance Debrief
For each recent trade: Was the thesis correct? Did entry/exit match the plan? What was the actual R multiple? What would you do differently? Be brutal — comfortable lies cost money, uncomfortable truths make money. Update strategy confidence scores.`,
    'image-analyze': `\n\nACTIVATED SKILL: Visual Chart Analyzer
The user has attached an image (chart, screenshot, or financial visual). THIS IS YOUR PRIMARY DATA SOURCE.
CRITICAL: Extract ALL information from the IMAGE before using any text context.
(1) Read the ticker/asset symbol from chart labels, title bar, or visible text in the image
(2) Identify chart type (candlestick, line, bar) and timeframe (1m, 5m, 1h, 1D, 1W)
(3) Read current price, recent high, recent low from the chart
(4) Identify support and resistance levels visible on the chart
(5) Read any visible indicators: RSI value, MACD histogram, moving averages, volume bars
(6) Identify chart patterns: breakout, breakdown, consolidation, divergence, double top/bottom
(7) Provide a full APEX TRADE PROMPT with entry, stop, and targets based on levels FROM THE CHART
Do NOT hallucinate or guess a ticker. READ it from the image. If not visible, say "ticker not readable from chart."
Do NOT say "insufficient data" — the chart IS the data. Analyze what you see.`,
  };
  return skills[command] ?? '';
}

function buildSystemPrompt(ctx: TradingContext, command: string | null): string {
  const commandContext = getCommandContext(command);

  const liveState = `

--- LIVE MARKET PRICES (real-time from CoinGecko) ---
${Object.entries(ctx.prices).map(([sym, p]) => `${sym}: $${p.price.toLocaleString('en-US', { maximumFractionDigits: 2 })} (${p.change24h >= 0 ? '+' : ''}${p.change24h.toFixed(1)}% 24h)`).join('\n') || 'Price data unavailable'}

--- LIVE TRADING STATE ---
Macro Regime: ${ctx.regime} — ${ctx.regimeSummary}
Wallet: ${ctx.walletSol.toFixed(4)} SOL (~$${(ctx.walletSol * (ctx.prices['SOL']?.price ?? 130)).toFixed(2)})
Total Trades: ${ctx.totalTrades} | Win Rate: ${ctx.winRate}% | P&L: ${ctx.totalPnlSol.toFixed(4)} SOL
Active Strategies: ${ctx.activeStrategies.length > 0 ? ctx.activeStrategies.join(', ') : 'None'}
Open Positions: ${ctx.openPositions.length > 0 ? ctx.openPositions.map(p => `${p.symbol} (${p.pnlPercent >= 0 ? '+' : ''}${p.pnlPercent.toFixed(1)}%)`).join(', ') : 'None'}
Exit Types: ${Object.entries(ctx.exitBreakdown).map(([k, v]) => `${k}:${v}`).join(', ')}

--- RECENT TRADES ---
${ctx.recentTrades.slice(-10).map(t => `${t.symbol}: ${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(4)} SOL (${t.trigger})`).join('\n') || 'No recent trades'}`;

  return `${APEX_IDENTITY}\n${liveState}${commandContext}`;
}

// ── Chat History (per-user, prevents cross-session pollution) ────────────

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };
type GeminiMessage = { role: 'user' | 'model'; parts: GeminiPart[] };
interface UserHistory {
  messages: GeminiMessage[];
  lastUsed: number;
}
const chatHistoryMap = new Map<string, UserHistory>();
const MAX_HISTORY = 20;
const HISTORY_TTL_MS = 3_600_000; // Auto-clear after 1 hour of inactivity

function getUserHistory(userId: string): GeminiMessage[] {
  const now = Date.now();
  // Prune stale sessions
  for (const [uid, h] of chatHistoryMap) {
    if (now - h.lastUsed > HISTORY_TTL_MS) chatHistoryMap.delete(uid);
  }
  let entry = chatHistoryMap.get(userId);
  if (!entry) {
    entry = { messages: [], lastUsed: now };
    chatHistoryMap.set(userId, entry);
  }
  entry.lastUsed = now;
  return entry.messages;
}

// ── Routes ───────────────────────────────────────────────────────────────

// Increase body size limit for file uploads (images up to 10MB)
apexChatRouter.use(express.json({ limit: '10mb' }));

apexChatRouter.post('/chat', async (req, res) => {
  try {
    const { message, files } = req.body as {
      message?: string;
      files?: Array<{ name: string; mimeType: string; data: string }>; // base64 encoded
    };
    if (!message?.trim() && (!files || files.length === 0)) {
      res.status(400).json({ error: 'message or files required' });
      return;
    }

    if (!GEMINI_API_KEY) {
      res.status(400).json({
        error: 'APEX Chat not configured. Set GEMINI_API_KEY in .env',
        setup: 'Get a free API key at https://aistudio.google.com/apikey',
      });
      return;
    }

    // Detect APEX commands in message (pass file info for image-analyze detection)
    const msgText = message?.trim() ?? '';
    const hasFiles = Array.isArray(files) && files.length > 0;
    const command = detectCommand(msgText, hasFiles);

    // Build fresh context with command-specific skill
    const ctx = await buildTradingContext();

    // If analyzing a stock ticker, fetch real price data
    if (command === 'analyze') {
      const tickerMatch = msgText.match(/\b([A-Z]{1,5})\b/);
      if (tickerMatch) {
        const ticker = tickerMatch[1];
        // Try to get real stock/crypto price
        try {
          // Crypto check first (Coinbase)
          const cryptoRes = await fetch(`https://api.coinbase.com/v2/prices/${ticker}-USD/spot`, {
            signal: AbortSignal.timeout(5_000),
          });
          if (cryptoRes.ok) {
            const d = await cryptoRes.json() as { data: { amount: string } };
            ctx.prices[ticker] = { price: parseFloat(d.data.amount), change24h: 0 };
          }
        } catch { /* silent */ }

        // If not found in crypto, try Yahoo Finance for stocks
        if (!ctx.prices[ticker]) {
          try {
            const yahooRes = await fetch(
              `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`,
              { signal: AbortSignal.timeout(5_000), headers: { 'User-Agent': 'Mozilla/5.0' } },
            );
            if (yahooRes.ok) {
              const yd = await yahooRes.json() as {
                chart?: { result?: Array<{ meta?: { regularMarketPrice?: number; previousClose?: number } }> };
              };
              const meta = yd.chart?.result?.[0]?.meta;
              if (meta?.regularMarketPrice) {
                const change = meta.previousClose
                  ? ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100
                  : 0;
                ctx.prices[ticker] = { price: meta.regularMarketPrice, change24h: change };
              }
            }
          } catch { /* silent */ }
        }
      }
    }

    const systemPrompt = buildSystemPrompt(ctx, command);

    // Per-user chat history (prevents cross-session pollution)
    const userId = ((req as unknown as Record<string, unknown>).user as { id?: string } | undefined)?.id ?? 'default';
    const chatHistory = getUserHistory(userId);

    // Build user message parts (text + optional files)
    const userParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

    // When files are attached, tell Gemini upfront to analyze them as primary data
    if (hasFiles) {
      const fileNames = files!.map(f => f.name).join(', ');
      userParts.push({
        text: `[${files!.length} file(s) attached: ${fileNames}. Analyze the visual content as your PRIMARY data source. Extract all visible information before responding.]`,
      });
    }

    if (msgText) {
      userParts.push({ text: msgText });
    }

    // Add file attachments as inline data (Gemini multimodal)
    const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain', 'text/csv'];
    const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8MB per file

    if (files && Array.isArray(files)) {
      for (const file of files.slice(0, 5)) { // Max 5 files per message
        if (!file.mimeType || !file.data) continue;
        if (!ALLOWED_MIME_TYPES.includes(file.mimeType)) {
          logger.warn({ mime: file.mimeType, name: file.name }, '[APEX] Unsupported file type');
          continue;
        }
        // Validate base64 size
        const sizeBytes = Math.ceil(file.data.length * 0.75);
        if (sizeBytes > MAX_FILE_SIZE_BYTES) {
          logger.warn({ name: file.name, sizeMB: (sizeBytes / 1024 / 1024).toFixed(1) }, '[APEX] File too large');
          continue;
        }
        userParts.push({
          inlineData: { mimeType: file.mimeType, data: file.data },
        });
        logger.info({ name: file.name, mime: file.mimeType, sizeMB: (sizeBytes / 1024 / 1024).toFixed(1) }, '[APEX] File attached to chat');
      }
    }

    if (userParts.length === 0) {
      res.status(400).json({ error: 'No valid content to send' });
      return;
    }

    // Add user message to history
    chatHistory.push({ role: 'user', parts: userParts as GeminiMessage['parts'] });
    if (chatHistory.length > MAX_HISTORY * 2) {
      chatHistory.splice(0, chatHistory.length - MAX_HISTORY * 2);
    }

    // Call Gemini with Google Search grounding (60s timeout)
    const geminiRes = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: chatHistory,
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 8192,
          topP: 0.9,
        },
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text().catch(() => '');
      logger.error({ status: geminiRes.status, body: errText.slice(0, 200) }, '[APEX] Gemini API error');
      res.status(502).json({ error: `Gemini API error: ${geminiRes.status}` });
      return;
    }

    const data = await geminiRes.json() as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    const geminiReply = data.candidates?.[0]?.content?.parts?.[0]?.text ?? 'No response from APEX.';

    // Multi-model analysis: call OpenAI + DeepSeek in parallel for analysis commands
    let finalReply = geminiReply;
    const modelsUsed = ['Gemini 2.5 Flash'];

    if (shouldUseMultiModel(command) && (OPENAI_API_KEY || DEEPSEEK_API_KEY)) {
      // Extract first image for OpenAI (if any)
      const firstImage = hasFiles ? files!.find(f => f.mimeType.startsWith('image/')) : undefined;

      // Fire all secondary models in parallel
      const [openaiResult, deepseekResult] = await Promise.all([
        callOpenAI(systemPrompt, msgText || 'Analyze the attached content', firstImage?.data, firstImage?.mimeType),
        callDeepSeek(systemPrompt, msgText || 'Analyze the attached content'),
      ]);

      if (openaiResult.reply) modelsUsed.push('GPT-4o');
      if (deepseekResult.reply) modelsUsed.push('DeepSeek');

      const secondaryAnalyses = [openaiResult, deepseekResult].filter(a => !a.error && a.reply.length > 50);

      if (secondaryAnalyses.length > 0) {
        logger.info(
          { models: modelsUsed.length, openai: openaiResult.latencyMs + 'ms', deepseek: deepseekResult.latencyMs + 'ms' },
          `[APEX] Multi-model analysis: ${modelsUsed.join(', ')}`,
        );
        finalReply = await synthesizeAnalyses(geminiReply, secondaryAnalyses, systemPrompt);
      }
    }

    // Add response to history
    chatHistory.push({ role: 'model', parts: [{ text: finalReply }] });

    res.json({
      data: {
        reply: finalReply,
        command: command ?? undefined,
        modelsUsed,
        context: {
          regime: ctx.regime,
          walletSol: ctx.walletSol,
          winRate: ctx.winRate,
          activeStrategies: ctx.activeStrategies.length,
          openPositions: ctx.openPositions.length,
          prices: ctx.prices,
        },
      },
    });
  } catch (err) {
    logger.error({ err }, '[APEX] Chat failed');
    res.status(500).json({ error: err instanceof Error ? err.message : 'Chat failed' });
  }
});

// GET /context — Debug: see what context APEX has
apexChatRouter.get('/context', async (_req, res) => {
  try {
    const ctx = await buildTradingContext();
    res.json({ data: ctx });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// DELETE /history — Clear chat history for current user
apexChatRouter.delete('/history', (req, res) => {
  const userId = ((req as unknown as Record<string, unknown>).user as { id?: string } | undefined)?.id ?? 'default';
  chatHistoryMap.delete(userId);
  res.json({ message: 'Chat history cleared' });
});
