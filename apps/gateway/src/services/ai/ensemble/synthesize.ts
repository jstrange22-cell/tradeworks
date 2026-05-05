/**
 * Chat-style synthesis — used by apex-chat.ts.
 *
 * Takes a primary reply + secondary model analyses and asks Gemini to merge
 * them into a single APEX-formatted response. This preserves the exact
 * behavior of the original `synthesizeAnalyses()` in apex-chat.ts.
 */
import { logger } from '../../../lib/logger.js';
import type { ModelResponse } from './types.js';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

/**
 * Synthesize multiple model analyses into a unified APEX response.
 * Returns `primary` unchanged when there are no useful secondaries or when the
 * synthesis call itself fails — chat behavior MUST never regress.
 */
export async function synthesizeResponses(
  primary: string,
  secondaries: ModelResponse[],
  systemPrompt: string,
): Promise<string> {
  const valid = secondaries.filter((a) => a.reply.length > 50 && !a.error);
  if (valid.length === 0) return primary;

  const synthesisPrompt = `You are APEX. You just received analysis from ${valid.length + 1} different AI models on the same request. Your job is to synthesize the BEST insights from all of them into one unified, actionable response.

YOUR primary analysis:
${primary}

${valid.map((a) => `--- ${a.model.toUpperCase()} ANALYSIS (${a.latencyMs}ms) ---\n${a.reply}`).join('\n\n')}

SYNTHESIS RULES:
1. Lead with the CONSENSUS — what do all models agree on?
2. Highlight any DISAGREEMENTS between models — these are where alpha lives
3. If one model found something the others missed, include it
4. Use the most specific price levels from whichever model provided them
5. Keep the APEX TRADE PROMPT format for the final recommendation
6. At the end, note which models contributed
7. Be concise — don't repeat the same point from different models`;

  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) return primary;
  try {
    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
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
    if (!res.ok) {
      logger.warn({ status: res.status }, '[ensemble.synthesize] Gemini error — returning primary');
      return primary + '\n\n---\n*Multi-model synthesis unavailable*';
    }
    const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? primary;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[ensemble.synthesize] threw — returning primary');
    return primary + '\n\n---\n*Multi-model synthesis unavailable*';
  }
}
