/**
 * Arb Reasoner — LLM-Powered Complex Decisions
 *
 * Used for:
 * - Type 4: Verify logical dependencies between markets
 * - Type 7: Validate options model confidence
 * - Type 3/6: Check settlement rule differences
 *
 * Uses Gemini 2.5 Flash (free tier) to avoid cost.
 * Falls back to rule-based decisions if LLM unavailable.
 */

import { logger } from '../../lib/logger.js';
import type { ArbOpportunity } from './models.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

interface LlmResponse {
  success: boolean;
  answer: string;
  confidence: number;
}

async function callLlm(prompt: string): Promise<LlmResponse> {
  if (!GEMINI_API_KEY) {
    return { success: false, answer: 'No LLM API key configured', confidence: 0 };
  }

  try {
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 500 },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      logger.warn({ status: res.status }, '[ArbReasoner] LLM API error');
      return { success: false, answer: `API error ${res.status}`, confidence: 0 };
    }

    const data = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    return { success: true, answer: text, confidence: 0.8 };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[ArbReasoner] LLM call failed');
    return { success: false, answer: 'LLM call failed', confidence: 0 };
  }
}

// ── Type 4: Verify Combinatorial Dependency ─────────────────────────────

export interface DependencyVerification {
  valid: boolean;
  relationship: string;
  confidence: number;
  reasoning: string;
  edgeCases: string[];
}

export async function verifyCombinatorialDependency(opp: ArbOpportunity): Promise<DependencyVerification> {
  const prompt = `You are an arbitrage verification system. Analyze these two prediction markets for logical dependency.

Market A: "${opp.marketATitle || opp.title_a}" (YES price: ${(opp.price_a * 100).toFixed(0)}%)
Market B: "${opp.marketBTitle || opp.title_b}" (YES price: ${(opp.price_b * 100).toFixed(0)}%)

Claimed relationship: "${opp.reasoning}"

Answer in this exact JSON format:
{"valid": true/false, "relationship": "implies|implied_by|mutually_exclusive|equivalent|independent", "confidence": 0.0-1.0, "reasoning": "one sentence", "edge_cases": ["case1", "case2"]}

Rules:
- "A implies B" means if A happens, B MUST happen (P(A) ≤ P(B) always)
- "mutually_exclusive" means A and B cannot BOTH happen (P(A)+P(B) ≤ 1)
- Be skeptical. Markets often have subtle differences in settlement rules.
- Return {"valid": false} if the relationship is uncertain or market definitions differ.`;

  const result = await callLlm(prompt);
  if (!result.success) {
    return { valid: false, relationship: 'unknown', confidence: 0, reasoning: 'LLM unavailable', edgeCases: [] };
  }

  try {
    // Extract JSON from response
    const jsonMatch = result.answer.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    const parsed = JSON.parse(jsonMatch[0]) as {
      valid: boolean;
      relationship: string;
      confidence: number;
      reasoning: string;
      edge_cases: string[];
    };

    return {
      valid: parsed.valid,
      relationship: parsed.relationship,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning,
      edgeCases: parsed.edge_cases || [],
    };
  } catch {
    return { valid: false, relationship: 'parse_error', confidence: 0, reasoning: 'Failed to parse LLM response', edgeCases: [] };
  }
}

// ── Type 3/6: Settlement Rule Check ─────────────────────────────────────

export interface SettlementCheck {
  safe: boolean;
  risk: 'low' | 'medium' | 'high';
  reasoning: string;
}

const KNOWN_DIVERGENCES: Record<string, string> = {
  government_shutdown: 'Polymarket=OPM announcement, Kalshi=24hr actual shutdown',
  election_results: 'Polymarket=AP call, Kalshi=official certification',
  temperature: 'Different weather station sources possible',
};

export async function checkSettlementRisk(opp: ArbOpportunity): Promise<SettlementCheck> {
  // Same venue = no settlement risk
  if (opp.venue_a === opp.venue_b) {
    return { safe: true, risk: 'low', reasoning: 'Same venue — identical settlement rules' };
  }

  // Check known divergences
  const titleLower = (opp.title_a + ' ' + opp.title_b).toLowerCase();
  for (const [keyword, divergence] of Object.entries(KNOWN_DIVERGENCES)) {
    if (titleLower.includes(keyword.replace('_', ' '))) {
      return {
        safe: false,
        risk: 'high',
        reasoning: `Known settlement divergence: ${divergence}`,
      };
    }
  }

  // Default: medium risk for cross-platform
  return {
    safe: true,
    risk: 'medium',
    reasoning: 'Cross-platform — no known settlement divergence detected',
  };
}

// ── Type 7: Options Model Confidence ────────────────────────────────────

export function verifyOptionsModel(opp: ArbOpportunity): { valid: boolean; confidence: number; reasoning: string } {
  const edge = Math.abs((opp.optionsImpliedProb ?? 0) - (opp.marketImpliedProb ?? 0));

  // Higher edge = lower confidence (more likely model error)
  // >15% edge = 50% conf, >10% = 60%, >5% = 75%
  let confidence: number;
  if (edge > 0.15) confidence = 0.50;
  else if (edge > 0.10) confidence = 0.60;
  else confidence = 0.75;

  return {
    valid: edge > 0.05,
    confidence,
    reasoning: `Options edge ${(edge * 100).toFixed(1)}% → confidence ${(confidence * 100).toFixed(0)}%`,
  };
}
