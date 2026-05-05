/**
 * Static factor map — symbol → {sector, betaToSpy, factorTags}.
 *
 * Hand-curated for v2 covering ~200 liquid US large-caps + sector ETFs.
 * Symbols not in the map default to `{ sector: 'Unknown', factorTags: ['large_cap'] }`
 * and emit a one-time warn so we can tell when the universe outgrows this file.
 *
 * Follow-up (tracked as v3 backlog): replace with a dynamic ETL job pulling
 * sector + beta from one of:
 *   - Polygon /v3/reference/tickers
 *   - FMP /api/v3/profile/{symbol}
 *   - Alpaca /v2/assets/{symbol} (sector field is partial)
 *
 * Until then this file is the single source of truth used by the heat tracker
 * for sector- and factor-budget enforcement.
 */

import { logger } from '../../lib/logger.js';
import type { FactorMeta, GICSSector, FactorTag } from './heat-types.js';

const DEFAULT_META: FactorMeta = {
  sector: 'Unknown',
  factorTags: ['large_cap'],
};

// Track which unknown symbols we've already warned about so the log doesn't
// spam on every signal. Cleared on process restart.
const warnedUnknown = new Set<string>();

/**
 * Hand-curated factor map. Beta values are rough 3y vs SPY estimates from
 * public sources (Yahoo Finance, Finviz) circa 2026-Q1 — they don't need
 * 4-decimal precision since we only use them for tagging high_beta/low_vol.
 */
export const FACTOR_MAP: Record<string, FactorMeta> = {
  // ── Technology — Mega-cap (high beta + momentum + large_cap + growth) ──
  AAPL:  { sector: 'Technology', betaToSpy: 1.25, factorTags: ['momentum', 'large_cap', 'growth'] },
  MSFT:  { sector: 'Technology', betaToSpy: 1.10, factorTags: ['momentum', 'large_cap', 'growth'] },
  NVDA:  { sector: 'Technology', betaToSpy: 1.85, factorTags: ['momentum', 'large_cap', 'high_beta', 'growth'] },
  AVGO:  { sector: 'Technology', betaToSpy: 1.40, factorTags: ['momentum', 'large_cap', 'high_beta', 'growth'] },
  AMD:   { sector: 'Technology', betaToSpy: 1.95, factorTags: ['momentum', 'large_cap', 'high_beta', 'growth'] },
  INTC:  { sector: 'Technology', betaToSpy: 1.05, factorTags: ['value', 'large_cap'] },
  QCOM:  { sector: 'Technology', betaToSpy: 1.30, factorTags: ['large_cap', 'high_beta', 'growth'] },
  TXN:   { sector: 'Technology', betaToSpy: 1.05, factorTags: ['large_cap', 'dividend'] },
  ORCL:  { sector: 'Technology', betaToSpy: 1.00, factorTags: ['large_cap', 'dividend', 'value'] },
  CRM:   { sector: 'Technology', betaToSpy: 1.30, factorTags: ['large_cap', 'growth'] },
  ADBE:  { sector: 'Technology', betaToSpy: 1.25, factorTags: ['large_cap', 'growth'] },
  NOW:   { sector: 'Technology', betaToSpy: 1.30, factorTags: ['large_cap', 'growth', 'momentum'] },
  PANW:  { sector: 'Technology', betaToSpy: 1.40, factorTags: ['large_cap', 'high_beta', 'growth', 'momentum'] },
  CRWD:  { sector: 'Technology', betaToSpy: 1.55, factorTags: ['large_cap', 'high_beta', 'growth', 'momentum'] },
  SNOW:  { sector: 'Technology', betaToSpy: 1.50, factorTags: ['large_cap', 'high_beta', 'growth'] },
  PLTR:  { sector: 'Technology', betaToSpy: 1.85, factorTags: ['high_beta', 'growth', 'momentum'] },
  SHOP:  { sector: 'Technology', betaToSpy: 1.95, factorTags: ['high_beta', 'growth', 'momentum'] },
  MU:    { sector: 'Technology', betaToSpy: 1.55, factorTags: ['large_cap', 'high_beta'] },
  AMAT:  { sector: 'Technology', betaToSpy: 1.50, factorTags: ['large_cap', 'high_beta'] },
  LRCX:  { sector: 'Technology', betaToSpy: 1.50, factorTags: ['large_cap', 'high_beta'] },
  KLAC:  { sector: 'Technology', betaToSpy: 1.45, factorTags: ['large_cap', 'high_beta'] },
  CSCO:  { sector: 'Technology', betaToSpy: 0.85, factorTags: ['large_cap', 'dividend', 'low_vol'] },
  IBM:   { sector: 'Technology', betaToSpy: 0.80, factorTags: ['large_cap', 'dividend', 'value', 'low_vol'] },
  ACN:   { sector: 'Technology', betaToSpy: 1.10, factorTags: ['large_cap', 'dividend'] },
  INTU:  { sector: 'Technology', betaToSpy: 1.15, factorTags: ['large_cap', 'growth'] },

  // ── Communication Services ──
  GOOGL: { sector: 'Communication Services', betaToSpy: 1.05, factorTags: ['momentum', 'large_cap', 'growth'] },
  GOOG:  { sector: 'Communication Services', betaToSpy: 1.05, factorTags: ['momentum', 'large_cap', 'growth'] },
  META:  { sector: 'Communication Services', betaToSpy: 1.30, factorTags: ['momentum', 'large_cap', 'high_beta', 'growth'] },
  NFLX:  { sector: 'Communication Services', betaToSpy: 1.35, factorTags: ['momentum', 'large_cap', 'high_beta', 'growth'] },
  DIS:   { sector: 'Communication Services', betaToSpy: 1.10, factorTags: ['large_cap', 'value'] },
  CMCSA: { sector: 'Communication Services', betaToSpy: 1.05, factorTags: ['large_cap', 'dividend', 'value'] },
  T:     { sector: 'Communication Services', betaToSpy: 0.65, factorTags: ['large_cap', 'dividend', 'low_vol', 'value'] },
  VZ:    { sector: 'Communication Services', betaToSpy: 0.40, factorTags: ['large_cap', 'dividend', 'low_vol', 'value'] },
  TMUS:  { sector: 'Communication Services', betaToSpy: 0.65, factorTags: ['large_cap', 'low_vol'] },

  // ── Consumer Discretionary ──
  AMZN:  { sector: 'Consumer Discretionary', betaToSpy: 1.20, factorTags: ['momentum', 'large_cap', 'growth'] },
  TSLA:  { sector: 'Consumer Discretionary', betaToSpy: 2.00, factorTags: ['momentum', 'large_cap', 'high_beta', 'growth'] },
  HD:    { sector: 'Consumer Discretionary', betaToSpy: 1.05, factorTags: ['large_cap', 'dividend'] },
  LOW:   { sector: 'Consumer Discretionary', betaToSpy: 1.10, factorTags: ['large_cap', 'dividend'] },
  MCD:   { sector: 'Consumer Discretionary', betaToSpy: 0.65, factorTags: ['large_cap', 'dividend', 'low_vol'] },
  SBUX:  { sector: 'Consumer Discretionary', betaToSpy: 1.05, factorTags: ['large_cap', 'dividend'] },
  NKE:   { sector: 'Consumer Discretionary', betaToSpy: 1.10, factorTags: ['large_cap', 'dividend'] },
  TGT:   { sector: 'Consumer Discretionary', betaToSpy: 1.10, factorTags: ['large_cap', 'dividend', 'value'] },
  BKNG:  { sector: 'Consumer Discretionary', betaToSpy: 1.30, factorTags: ['large_cap', 'high_beta', 'growth'] },
  ABNB:  { sector: 'Consumer Discretionary', betaToSpy: 1.30, factorTags: ['large_cap', 'high_beta', 'growth'] },
  UBER:  { sector: 'Consumer Discretionary', betaToSpy: 1.40, factorTags: ['large_cap', 'high_beta', 'growth', 'momentum'] },
  F:     { sector: 'Consumer Discretionary', betaToSpy: 1.45, factorTags: ['high_beta', 'value', 'dividend'] },
  GM:    { sector: 'Consumer Discretionary', betaToSpy: 1.45, factorTags: ['high_beta', 'value'] },
  CMG:   { sector: 'Consumer Discretionary', betaToSpy: 1.20, factorTags: ['large_cap', 'growth'] },

  // ── Consumer Staples ──
  WMT:   { sector: 'Consumer Staples', betaToSpy: 0.55, factorTags: ['large_cap', 'dividend', 'low_vol'] },
  COST:  { sector: 'Consumer Staples', betaToSpy: 0.80, factorTags: ['large_cap', 'low_vol', 'growth'] },
  PG:    { sector: 'Consumer Staples', betaToSpy: 0.45, factorTags: ['large_cap', 'dividend', 'low_vol'] },
  KO:    { sector: 'Consumer Staples', betaToSpy: 0.55, factorTags: ['large_cap', 'dividend', 'low_vol'] },
  PEP:   { sector: 'Consumer Staples', betaToSpy: 0.55, factorTags: ['large_cap', 'dividend', 'low_vol'] },
  PM:    { sector: 'Consumer Staples', betaToSpy: 0.55, factorTags: ['large_cap', 'dividend', 'low_vol'] },
  MO:    { sector: 'Consumer Staples', betaToSpy: 0.55, factorTags: ['large_cap', 'dividend', 'low_vol', 'value'] },
  CL:    { sector: 'Consumer Staples', betaToSpy: 0.45, factorTags: ['large_cap', 'dividend', 'low_vol'] },
  MDLZ:  { sector: 'Consumer Staples', betaToSpy: 0.55, factorTags: ['large_cap', 'dividend', 'low_vol'] },

  // ── Financials ──
  JPM:   { sector: 'Financials', betaToSpy: 1.10, factorTags: ['large_cap', 'dividend'] },
  BAC:   { sector: 'Financials', betaToSpy: 1.30, factorTags: ['large_cap', 'dividend', 'value'] },
  WFC:   { sector: 'Financials', betaToSpy: 1.20, factorTags: ['large_cap', 'dividend', 'value'] },
  C:     { sector: 'Financials', betaToSpy: 1.50, factorTags: ['large_cap', 'dividend', 'value', 'high_beta'] },
  GS:    { sector: 'Financials', betaToSpy: 1.40, factorTags: ['large_cap', 'high_beta', 'dividend'] },
  MS:    { sector: 'Financials', betaToSpy: 1.40, factorTags: ['large_cap', 'high_beta', 'dividend'] },
  BLK:   { sector: 'Financials', betaToSpy: 1.20, factorTags: ['large_cap', 'dividend'] },
  SCHW:  { sector: 'Financials', betaToSpy: 1.20, factorTags: ['large_cap', 'dividend'] },
  AXP:   { sector: 'Financials', betaToSpy: 1.20, factorTags: ['large_cap', 'dividend'] },
  V:     { sector: 'Financials', betaToSpy: 0.95, factorTags: ['large_cap', 'growth'] },
  MA:    { sector: 'Financials', betaToSpy: 1.00, factorTags: ['large_cap', 'growth'] },
  PYPL:  { sector: 'Financials', betaToSpy: 1.50, factorTags: ['large_cap', 'high_beta', 'growth'] },
  COF:   { sector: 'Financials', betaToSpy: 1.50, factorTags: ['large_cap', 'high_beta', 'value', 'dividend'] },
  USB:   { sector: 'Financials', betaToSpy: 1.05, factorTags: ['large_cap', 'dividend', 'value'] },
  PNC:   { sector: 'Financials', betaToSpy: 1.10, factorTags: ['large_cap', 'dividend', 'value'] },
  TFC:   { sector: 'Financials', betaToSpy: 1.10, factorTags: ['large_cap', 'dividend', 'value'] },
  CB:    { sector: 'Financials', betaToSpy: 0.65, factorTags: ['large_cap', 'dividend', 'low_vol'] },
  BRK_B: { sector: 'Financials', betaToSpy: 0.85, factorTags: ['large_cap', 'low_vol', 'value'] },
  // Common Berkshire ticker variants seen in data feeds:
  'BRK.B': { sector: 'Financials', betaToSpy: 0.85, factorTags: ['large_cap', 'low_vol', 'value'] },

  // ── Health Care ──
  UNH:   { sector: 'Health Care', betaToSpy: 0.65, factorTags: ['large_cap', 'low_vol'] },
  JNJ:   { sector: 'Health Care', betaToSpy: 0.55, factorTags: ['large_cap', 'dividend', 'low_vol'] },
  LLY:   { sector: 'Health Care', betaToSpy: 0.50, factorTags: ['large_cap', 'low_vol', 'growth', 'momentum'] },
  PFE:   { sector: 'Health Care', betaToSpy: 0.65, factorTags: ['large_cap', 'dividend', 'low_vol', 'value'] },
  MRK:   { sector: 'Health Care', betaToSpy: 0.50, factorTags: ['large_cap', 'dividend', 'low_vol'] },
  ABBV:  { sector: 'Health Care', betaToSpy: 0.65, factorTags: ['large_cap', 'dividend', 'low_vol'] },
  TMO:   { sector: 'Health Care', betaToSpy: 0.95, factorTags: ['large_cap'] },
  ABT:   { sector: 'Health Care', betaToSpy: 0.75, factorTags: ['large_cap', 'dividend', 'low_vol'] },
  DHR:   { sector: 'Health Care', betaToSpy: 0.95, factorTags: ['large_cap'] },
  AMGN:  { sector: 'Health Care', betaToSpy: 0.65, factorTags: ['large_cap', 'dividend', 'low_vol'] },
  GILD:  { sector: 'Health Care', betaToSpy: 0.60, factorTags: ['large_cap', 'dividend', 'low_vol', 'value'] },
  CVS:   { sector: 'Health Care', betaToSpy: 0.75, factorTags: ['large_cap', 'dividend', 'value'] },
  ELV:   { sector: 'Health Care', betaToSpy: 0.70, factorTags: ['large_cap', 'low_vol'] },
  HUM:   { sector: 'Health Care', betaToSpy: 0.70, factorTags: ['large_cap', 'low_vol'] },
  ISRG:  { sector: 'Health Care', betaToSpy: 1.10, factorTags: ['large_cap', 'growth'] },
  REGN:  { sector: 'Health Care', betaToSpy: 0.65, factorTags: ['large_cap', 'low_vol', 'growth'] },
  VRTX:  { sector: 'Health Care', betaToSpy: 0.55, factorTags: ['large_cap', 'low_vol', 'growth'] },
  MDT:   { sector: 'Health Care', betaToSpy: 0.85, factorTags: ['large_cap', 'dividend', 'low_vol'] },

  // ── Industrials ──
  CAT:   { sector: 'Industrials', betaToSpy: 1.10, factorTags: ['large_cap', 'dividend'] },
  DE:    { sector: 'Industrials', betaToSpy: 1.15, factorTags: ['large_cap', 'dividend'] },
  BA:    { sector: 'Industrials', betaToSpy: 1.45, factorTags: ['large_cap', 'high_beta'] },
  RTX:   { sector: 'Industrials', betaToSpy: 0.80, factorTags: ['large_cap', 'dividend', 'low_vol'] },
  LMT:   { sector: 'Industrials', betaToSpy: 0.50, factorTags: ['large_cap', 'dividend', 'low_vol'] },
  GE:    { sector: 'Industrials', betaToSpy: 1.15, factorTags: ['large_cap', 'momentum'] },
  HON:   { sector: 'Industrials', betaToSpy: 0.95, factorTags: ['large_cap', 'dividend'] },
  UPS:   { sector: 'Industrials', betaToSpy: 1.05, factorTags: ['large_cap', 'dividend'] },
  FDX:   { sector: 'Industrials', betaToSpy: 1.15, factorTags: ['large_cap', 'dividend'] },
  UNP:   { sector: 'Industrials', betaToSpy: 1.05, factorTags: ['large_cap', 'dividend'] },
  CSX:   { sector: 'Industrials', betaToSpy: 1.05, factorTags: ['large_cap', 'dividend'] },
  EMR:   { sector: 'Industrials', betaToSpy: 1.10, factorTags: ['large_cap', 'dividend'] },
  ETN:   { sector: 'Industrials', betaToSpy: 1.10, factorTags: ['large_cap', 'dividend'] },
  ITW:   { sector: 'Industrials', betaToSpy: 1.05, factorTags: ['large_cap', 'dividend'] },
  MMM:   { sector: 'Industrials', betaToSpy: 0.95, factorTags: ['large_cap', 'dividend', 'value'] },

  // ── Energy ──
  XOM:   { sector: 'Energy', betaToSpy: 0.95, factorTags: ['large_cap', 'dividend', 'value'] },
  CVX:   { sector: 'Energy', betaToSpy: 1.05, factorTags: ['large_cap', 'dividend', 'value'] },
  COP:   { sector: 'Energy', betaToSpy: 1.10, factorTags: ['large_cap', 'dividend', 'value'] },
  SLB:   { sector: 'Energy', betaToSpy: 1.55, factorTags: ['large_cap', 'high_beta', 'value'] },
  EOG:   { sector: 'Energy', betaToSpy: 1.40, factorTags: ['large_cap', 'dividend', 'high_beta', 'value'] },
  MPC:   { sector: 'Energy', betaToSpy: 1.30, factorTags: ['large_cap', 'dividend', 'value'] },
  PSX:   { sector: 'Energy', betaToSpy: 1.30, factorTags: ['large_cap', 'dividend', 'value'] },
  VLO:   { sector: 'Energy', betaToSpy: 1.40, factorTags: ['large_cap', 'dividend', 'high_beta', 'value'] },
  OXY:   { sector: 'Energy', betaToSpy: 1.85, factorTags: ['large_cap', 'high_beta', 'value'] },

  // ── Utilities ──
  NEE:   { sector: 'Utilities', betaToSpy: 0.55, factorTags: ['large_cap', 'dividend', 'low_vol'] },
  DUK:   { sector: 'Utilities', betaToSpy: 0.45, factorTags: ['large_cap', 'dividend', 'low_vol'] },
  SO:    { sector: 'Utilities', betaToSpy: 0.45, factorTags: ['large_cap', 'dividend', 'low_vol'] },
  D:     { sector: 'Utilities', betaToSpy: 0.50, factorTags: ['large_cap', 'dividend', 'low_vol'] },
  AEP:   { sector: 'Utilities', betaToSpy: 0.45, factorTags: ['large_cap', 'dividend', 'low_vol'] },
  EXC:   { sector: 'Utilities', betaToSpy: 0.55, factorTags: ['large_cap', 'dividend', 'low_vol'] },

  // ── Materials ──
  LIN:   { sector: 'Materials', betaToSpy: 0.95, factorTags: ['large_cap', 'dividend'] },
  APD:   { sector: 'Materials', betaToSpy: 0.95, factorTags: ['large_cap', 'dividend'] },
  ECL:   { sector: 'Materials', betaToSpy: 0.85, factorTags: ['large_cap', 'dividend'] },
  SHW:   { sector: 'Materials', betaToSpy: 1.10, factorTags: ['large_cap', 'dividend'] },
  FCX:   { sector: 'Materials', betaToSpy: 1.95, factorTags: ['large_cap', 'high_beta'] },
  NUE:   { sector: 'Materials', betaToSpy: 1.50, factorTags: ['large_cap', 'high_beta', 'dividend', 'value'] },
  NEM:   { sector: 'Materials', betaToSpy: 0.45, factorTags: ['large_cap', 'low_vol', 'dividend'] },
  DOW:   { sector: 'Materials', betaToSpy: 1.30, factorTags: ['large_cap', 'dividend', 'value'] },

  // ── Real Estate ──
  PLD:   { sector: 'Real Estate', betaToSpy: 1.05, factorTags: ['large_cap', 'dividend'] },
  AMT:   { sector: 'Real Estate', betaToSpy: 0.85, factorTags: ['large_cap', 'dividend', 'low_vol'] },
  EQIX:  { sector: 'Real Estate', betaToSpy: 0.85, factorTags: ['large_cap', 'dividend', 'low_vol'] },
  CCI:   { sector: 'Real Estate', betaToSpy: 0.85, factorTags: ['large_cap', 'dividend', 'low_vol'] },
  PSA:   { sector: 'Real Estate', betaToSpy: 0.75, factorTags: ['large_cap', 'dividend', 'low_vol'] },
  O:     { sector: 'Real Estate', betaToSpy: 0.65, factorTags: ['large_cap', 'dividend', 'low_vol'] },
  SPG:   { sector: 'Real Estate', betaToSpy: 1.45, factorTags: ['large_cap', 'high_beta', 'dividend', 'value'] },

  // ── Broad-market & Style ETFs (mapped to dominant sector / factor) ──
  SPY:   { sector: 'Unknown', betaToSpy: 1.00, factorTags: ['large_cap', 'low_vol'] },
  VOO:   { sector: 'Unknown', betaToSpy: 1.00, factorTags: ['large_cap', 'low_vol'] },
  IVV:   { sector: 'Unknown', betaToSpy: 1.00, factorTags: ['large_cap', 'low_vol'] },
  QQQ:   { sector: 'Technology', betaToSpy: 1.10, factorTags: ['large_cap', 'growth', 'momentum'] },
  IWM:   { sector: 'Unknown', betaToSpy: 1.20, factorTags: ['small_cap', 'high_beta'] },
  DIA:   { sector: 'Unknown', betaToSpy: 0.95, factorTags: ['large_cap', 'dividend', 'low_vol'] },
  VTI:   { sector: 'Unknown', betaToSpy: 1.00, factorTags: ['large_cap', 'low_vol'] },
  // Style ETFs
  MTUM:  { sector: 'Unknown', betaToSpy: 1.10, factorTags: ['momentum', 'large_cap'] },
  USMV:  { sector: 'Unknown', betaToSpy: 0.75, factorTags: ['low_vol', 'large_cap'] },
  VLUE:  { sector: 'Unknown', betaToSpy: 1.05, factorTags: ['value', 'large_cap'] },
  IWF:   { sector: 'Unknown', betaToSpy: 1.10, factorTags: ['growth', 'large_cap'] },
  IWD:   { sector: 'Unknown', betaToSpy: 0.95, factorTags: ['value', 'large_cap'] },
  VYM:   { sector: 'Unknown', betaToSpy: 0.85, factorTags: ['dividend', 'large_cap', 'low_vol'] },
  // Sector ETFs (SPDR Select)
  XLK:   { sector: 'Technology', betaToSpy: 1.20, factorTags: ['large_cap', 'growth'] },
  XLF:   { sector: 'Financials', betaToSpy: 1.15, factorTags: ['large_cap', 'value'] },
  XLV:   { sector: 'Health Care', betaToSpy: 0.65, factorTags: ['large_cap', 'low_vol'] },
  XLY:   { sector: 'Consumer Discretionary', betaToSpy: 1.20, factorTags: ['large_cap'] },
  XLP:   { sector: 'Consumer Staples', betaToSpy: 0.55, factorTags: ['large_cap', 'low_vol', 'dividend'] },
  XLI:   { sector: 'Industrials', betaToSpy: 1.05, factorTags: ['large_cap'] },
  XLE:   { sector: 'Energy', betaToSpy: 1.30, factorTags: ['large_cap', 'value', 'dividend'] },
  XLU:   { sector: 'Utilities', betaToSpy: 0.50, factorTags: ['large_cap', 'low_vol', 'dividend'] },
  XLB:   { sector: 'Materials', betaToSpy: 1.05, factorTags: ['large_cap'] },
  XLC:   { sector: 'Communication Services', betaToSpy: 1.05, factorTags: ['large_cap', 'growth'] },
  XLRE:  { sector: 'Real Estate', betaToSpy: 0.95, factorTags: ['large_cap', 'dividend', 'low_vol'] },
  // Commodity ETFs — bucketed under Materials for sector-budget purposes
  GLD:   { sector: 'Materials', betaToSpy: 0.10, factorTags: ['low_vol'] },
  SLV:   { sector: 'Materials', betaToSpy: 0.30, factorTags: ['low_vol'] },
  USO:   { sector: 'Energy', betaToSpy: 0.95, factorTags: ['high_beta'] },

  // ── Mid/Small-Cap & High-Beta Names ──
  ROKU:  { sector: 'Communication Services', betaToSpy: 2.00, factorTags: ['high_beta', 'growth', 'momentum'] },
  RBLX:  { sector: 'Communication Services', betaToSpy: 1.95, factorTags: ['high_beta', 'growth'] },
  COIN:  { sector: 'Financials', betaToSpy: 2.95, factorTags: ['high_beta', 'growth', 'momentum'] },
  HOOD:  { sector: 'Financials', betaToSpy: 2.40, factorTags: ['high_beta', 'growth', 'momentum'] },
  SOFI:  { sector: 'Financials', betaToSpy: 2.10, factorTags: ['small_cap', 'high_beta', 'growth'] },
  RIVN:  { sector: 'Consumer Discretionary', betaToSpy: 2.10, factorTags: ['high_beta', 'growth'] },
  LCID:  { sector: 'Consumer Discretionary', betaToSpy: 2.20, factorTags: ['small_cap', 'high_beta'] },
  NIO:   { sector: 'Consumer Discretionary', betaToSpy: 2.15, factorTags: ['high_beta'] },
  MARA:  { sector: 'Financials', betaToSpy: 3.50, factorTags: ['small_cap', 'high_beta', 'momentum'] },
  RIOT:  { sector: 'Financials', betaToSpy: 3.80, factorTags: ['small_cap', 'high_beta', 'momentum'] },
  MSTR:  { sector: 'Technology', betaToSpy: 2.85, factorTags: ['high_beta', 'momentum'] },
  GME:   { sector: 'Consumer Discretionary', betaToSpy: 1.85, factorTags: ['small_cap', 'high_beta'] },
  AMC:   { sector: 'Communication Services', betaToSpy: 2.20, factorTags: ['small_cap', 'high_beta'] },
  PYPL_LEGACY: { sector: 'Financials', betaToSpy: 1.50, factorTags: ['large_cap', 'value'] },
};

/**
 * Look up factor metadata for a symbol. Returns the static map entry, or
 * `DEFAULT_META` (sector: 'Unknown', factorTags: ['large_cap']) if unknown.
 *
 * Symbols not in the map emit a one-time warn so we can spot universe drift.
 * Repeated lookups for the same unknown symbol stay quiet.
 */
export function getFactorMeta(symbol: string): FactorMeta {
  const key = symbol.toUpperCase();
  const entry = FACTOR_MAP[key];
  if (entry) return entry;

  if (!warnedUnknown.has(key)) {
    warnedUnknown.add(key);
    logger.warn(
      { symbol: key },
      `[heat] symbol not in factor-map — defaulting to sector=Unknown, factorTags=[large_cap]`,
    );
  }
  return DEFAULT_META;
}

/** Re-export so callers can build a quick "is-known" check without re-importing the map. */
export function isKnownSymbol(symbol: string): boolean {
  return symbol.toUpperCase() in FACTOR_MAP;
}

/** Convenience for tests — wipe the warn-once set so coverage runs deterministically. */
export function _resetUnknownWarnCache(): void {
  warnedUnknown.clear();
}

// Type re-exports kept handy for callers
export type { FactorMeta, GICSSector, FactorTag };
