/**
 * APEX chat tool registry.
 *
 * Tools the conversational APEX agent (Claude/Gemini/etc.) can invoke. Each
 * entry has:
 *   - `name`         (snake_case, stable — used as the tool_use id)
 *   - `description`  (LLM-facing prose)
 *   - `inputSchema`  (Zod) — validated before `handler` runs
 *   - `handler`      — async, returns a JSON-serialisable result
 *
 * Today the registry is exposed via `POST /api/v1/apex/tools/:name` for
 * direct invocation by the dashboard / scripts. When apex-chat.ts grows
 * native tool_use / function-calling support, the same registry feeds into
 * the model's tool list — no duplication.
 *
 * Scope (initial cut, kill-switch related):
 *   1. kill_all_positions(reason)         → master kill
 *   2. pause_strategy(strategy, hours, reason)
 *   3. pause_portfolio(reason)
 *   4. kill_switch_status()               → JSON snapshot
 */

import { z } from 'zod';
import {
  activateMasterKill,
  getKillSwitchStatus,
  pausePortfolio,
  pauseStrategy,
} from '../orchestrator/kill-switches.js';

export interface ChatTool<I = unknown, O = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  handler: (input: I) => Promise<O>;
}

/** Type-erased entry for the registry. */
type AnyChatTool = ChatTool<unknown, unknown>;

// ── Tool: kill_all_positions ───────────────────────────────────────────

const KillAllInput = z.object({
  reason: z.string().min(1).max(500),
});

const killAllPositionsTool: ChatTool<z.infer<typeof KillAllInput>, unknown> = {
  name: 'kill_all_positions',
  description:
    'PANIC button. Activates the master kill switch: flattens ALL open positions immediately ' +
    '(equity, options, FreqTrade CEX trades) and blocks every new entry until manually deactivated. ' +
    'Use only when the user explicitly requests a full halt or describes a runaway loss.',
  inputSchema: KillAllInput,
  handler: async ({ reason }) => {
    await activateMasterKill(reason);
    return await getKillSwitchStatus();
  },
};

// ── Tool: pause_strategy ───────────────────────────────────────────────

const PauseStrategyInput = z.object({
  strategy: z.string().min(1).max(120),
  hours: z.number().positive().max(24 * 30),
  reason: z.string().min(1).max(500),
});

const pauseStrategyTool: ChatTool<z.infer<typeof PauseStrategyInput>, unknown> = {
  name: 'pause_strategy',
  description:
    'Pause a single trading strategy for the specified number of hours. The bandit weight ' +
    'collapses to the floor while paused. Use when one strategy is bleeding while others ' +
    'are healthy. Common case: 5 consecutive losses → 24-hour pause.',
  inputSchema: PauseStrategyInput,
  handler: async ({ strategy, hours, reason }) => {
    await pauseStrategy(strategy, hours, reason);
    return await getKillSwitchStatus();
  },
};

// ── Tool: pause_portfolio ──────────────────────────────────────────────

const PausePortfolioInput = z.object({
  reason: z.string().min(1).max(500),
});

const pausePortfolioTool: ChatTool<z.infer<typeof PausePortfolioInput>, unknown> = {
  name: 'pause_portfolio',
  description:
    'Pause ALL new entries across every strategy until manually resumed. Open positions ' +
    'continue to manage themselves via the exit stack — only entries are blocked. ' +
    'Use for portfolio-level drawdown scenarios when a master kill is too aggressive.',
  inputSchema: PausePortfolioInput,
  handler: async ({ reason }) => {
    await pausePortfolio(reason);
    return await getKillSwitchStatus();
  },
};

// ── Tool: kill_switch_status ───────────────────────────────────────────

const StatusInput = z.object({}).strict();

const killSwitchStatusTool: ChatTool<z.infer<typeof StatusInput>, unknown> = {
  name: 'kill_switch_status',
  description:
    'Return the full kill-switch system status as JSON: master/portfolio/strategy states ' +
    'plus realised PnL metrics (daily/weekly/monthly) and consecutive-loss runs per strategy. ' +
    'Use to answer "is anything paused right now?" type questions.',
  inputSchema: StatusInput,
  handler: async () => await getKillSwitchStatus(),
};

// ── Registry ───────────────────────────────────────────────────────────

const TOOLS: readonly AnyChatTool[] = [
  killAllPositionsTool as AnyChatTool,
  pauseStrategyTool as AnyChatTool,
  pausePortfolioTool as AnyChatTool,
  killSwitchStatusTool as AnyChatTool,
];

const TOOL_INDEX: Record<string, AnyChatTool> = Object.fromEntries(
  TOOLS.map((t) => [t.name, t]),
);

/** List all chat tools with their schemas (LLM-facing). */
export function listChatTools(): Array<{ name: string; description: string; inputSchemaJson: unknown }> {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    // We don't pull in zod-to-json-schema here to keep deps lean. Callers that
    // need a JSON-Schema dump can do `zod-to-json-schema` themselves.
    inputSchemaJson: { _note: 'see source for Zod schema; validated server-side' },
  }));
}

/** Get a single tool by name. */
export function getChatTool(name: string): AnyChatTool | undefined {
  return TOOL_INDEX[name];
}

/**
 * Invoke a chat tool by name with raw (unvalidated) input. Validation runs
 * before the handler. Returns the handler's result on success, or throws on
 * validation/handler error so callers can map to a 4xx/5xx HTTP response.
 */
export async function invokeChatTool(name: string, rawInput: unknown): Promise<unknown> {
  const tool = TOOL_INDEX[name];
  if (!tool) {
    const err = new Error(`unknown chat tool: ${name}`);
    (err as Error & { statusCode?: number }).statusCode = 404;
    throw err;
  }
  const parsed = tool.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const err = new Error(`invalid input for ${name}: ${parsed.error.message}`);
    (err as Error & { statusCode?: number }).statusCode = 400;
    (err as Error & { details?: unknown }).details = parsed.error.flatten();
    throw err;
  }
  return await tool.handler(parsed.data);
}
