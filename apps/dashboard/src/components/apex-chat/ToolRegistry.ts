/**
 * ToolRegistry — client-side mirror of the gateway's APEX chat tools.
 *
 * Fetches the tool list from `GET /apex/tools` once on mount and caches it.
 * Mutating tools (kill switches, pauses) are flagged `requiresConfirmation`
 * so the UI can require an explicit click before invoking.
 *
 * Tools that mutate state should be matched by NAME — gateway descriptions can
 * change but names are stable.
 */

import { apiClient } from '@/lib/api-client';

export interface RemoteTool {
  name: string;
  description: string;
  /** Gateway returns a placeholder; we just preserve it for completeness. */
  inputSchemaJson: unknown;
}

export interface ClientTool extends RemoteTool {
  /** True if invoking this tool changes server state (positions, switches). */
  requiresConfirmation: boolean;
  /** Human-friendly label for chips/buttons. */
  label: string;
}

/** Tool names that mutate state and must be confirmed in the UI. */
const MUTATING_TOOLS = new Set<string>([
  'kill_all_positions',
  'pause_strategy',
  'pause_portfolio',
]);

/** Pretty labels for known tools. Falls back to humanised tool name. */
const LABELS: Record<string, string> = {
  kill_all_positions: 'Kill all positions',
  pause_strategy: 'Pause strategy',
  pause_portfolio: 'Pause portfolio',
  kill_switch_status: 'Kill-switch status',
};

function humanise(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

let cache: ClientTool[] | null = null;
let cacheAt = 0;
const CACHE_TTL_MS = 60_000;

interface ToolsResponse {
  data: RemoteTool[];
}

export async function fetchTools(force = false): Promise<ClientTool[]> {
  if (!force && cache && Date.now() - cacheAt < CACHE_TTL_MS) return cache;
  try {
    const res = await apiClient.get<ToolsResponse>('/apex/tools');
    const remote = Array.isArray(res?.data) ? res.data : [];
    cache = remote.map((t) => ({
      ...t,
      requiresConfirmation: MUTATING_TOOLS.has(t.name),
      label: LABELS[t.name] ?? humanise(t.name),
    }));
    cacheAt = Date.now();
    return cache;
  } catch (err) {
    // If the gateway is offline or the route 404s, fall back to known tools so
    // quick-actions can still render.
    console.warn('[ApexChat] /apex/tools fetch failed; using static fallback', err);
    cache = [...MUTATING_TOOLS, 'kill_switch_status'].map((name) => ({
      name,
      description: '',
      inputSchemaJson: null,
      requiresConfirmation: MUTATING_TOOLS.has(name),
      label: LABELS[name] ?? humanise(name),
    }));
    cacheAt = Date.now();
    return cache;
  }
}

export function getCachedTools(): ClientTool[] {
  return cache ?? [];
}

export interface ToolInvocationResult {
  data?: unknown;
  error?: string;
  details?: unknown;
}

/** Invoke a tool by name. The gateway validates the args via Zod. */
export async function invokeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolInvocationResult> {
  try {
    const result = await apiClient.post<{ data: unknown }>(`/apex/tools/${encodeURIComponent(name)}`, args);
    return { data: result.data };
  } catch (err) {
    let message = 'Tool invocation failed';
    let details: unknown;
    if (err instanceof Error) {
      message = err.message;
      const body = (err as Error & { body?: unknown }).body;
      if (typeof body === 'string') {
        try {
          const parsed = JSON.parse(body) as { error?: string; details?: unknown };
          if (parsed.error) message = parsed.error;
          if (parsed.details !== undefined) details = parsed.details;
        } catch { /* keep default message */ }
      }
    }
    return { error: message, details };
  }
}
