import Anthropic from '@anthropic-ai/sdk';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolHandler {
  (params: Record<string, unknown>): Promise<unknown>;
}

export interface ClaudeAgentConfig {
  model: string;
  systemPrompt: string;
  tools: ToolDefinition[];
  toolHandlers: Map<string, ToolHandler>;
  maxTokens: number;
  temperature: number;
  maxToolRounds?: number;
}

// ---------------------------------------------------------------------------
// Singleton client
// ---------------------------------------------------------------------------

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        '[ClaudeClient] ANTHROPIC_API_KEY is not set. Set it in .env or disable Claude agents with USE_CLAUDE_AGENTS=false',
      );
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

// ---------------------------------------------------------------------------
// Agentic loop
// ---------------------------------------------------------------------------

/**
 * Run a Claude agent with tool use support.
 *
 * The loop:
 * 1. Send the user message with tool definitions
 * 2. If Claude responds with tool_use blocks, execute each tool
 * 3. Send tool results back as tool_result messages
 * 4. Repeat until Claude produces a final text response (or max rounds)
 *
 * Returns the final text content from Claude.
 */
export async function runClaudeAgent(
  config: ClaudeAgentConfig,
  userMessage: string,
): Promise<string> {
  const anthropic = getClient();
  const maxRounds = config.maxToolRounds ?? 10;

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userMessage },
  ];

  for (let round = 0; round < maxRounds; round++) {
    const response = await anthropic.messages.create({
      model: config.model,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      system: config.systemPrompt,
      tools: config.tools as Anthropic.Tool[],
      messages,
    });

    // Check if the response has any tool use blocks
    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === 'tool_use',
    );

    if (toolUseBlocks.length === 0) {
      // No tool calls — extract final text response
      const textBlocks = response.content.filter(
        (block): block is Anthropic.TextBlock => block.type === 'text',
      );
      return textBlocks.map((b) => b.text).join('\n');
    }

    // Add assistant message with tool use blocks
    messages.push({ role: 'assistant', content: response.content });

    // Execute each tool call and collect results
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      const handler = config.toolHandlers.get(toolUse.name);

      if (!handler) {
        console.warn(`[ClaudeClient] No handler for tool: ${toolUse.name}`);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify({ error: `Unknown tool: ${toolUse.name}` }),
          is_error: true,
        });
        continue;
      }

      try {
        const result = await handler(toolUse.input as Record<string, unknown>);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[ClaudeClient] Tool ${toolUse.name} failed: ${errorMsg}`);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify({ error: errorMsg }),
          is_error: true,
        });
      }
    }

    // Send tool results back
    messages.push({ role: 'user', content: toolResults });
  }

  // If we exhausted rounds, return whatever we have
  console.warn(`[ClaudeClient] Reached max tool rounds (${maxRounds})`);
  return '';
}

/**
 * Run a Claude agent and parse the response as JSON of type T.
 * Falls back to the provided fallback value if parsing fails.
 */
export async function runClaudeAgentStructured<T>(
  config: ClaudeAgentConfig,
  userMessage: string,
  fallback: T,
): Promise<T> {
  try {
    const rawResponse = await runClaudeAgent(config, userMessage);

    if (!rawResponse) {
      console.warn('[ClaudeClient] Empty response from Claude, using fallback');
      return fallback;
    }

    // Try to extract JSON from the response
    // Claude may wrap JSON in markdown code blocks
    const jsonMatch = rawResponse.match(/```(?:json)?\s*([\s\S]*?)```/) ??
                      rawResponse.match(/(\{[\s\S]*\})/);

    if (jsonMatch?.[1]) {
      return JSON.parse(jsonMatch[1].trim()) as T;
    }

    // Try parsing the entire response as JSON
    return JSON.parse(rawResponse) as T;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[ClaudeClient] Failed to parse structured response: ${errorMsg}`);
    return fallback;
  }
}

/**
 * Simple Claude completion without tools (for synthesis/summarization).
 */
export async function claudeComplete(
  systemPrompt: string,
  userMessage: string,
  options?: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
  },
): Promise<string> {
  const anthropic = getClient();

  const response = await anthropic.messages.create({
    model: options?.model ?? 'claude-sonnet-4-20250514',
    max_tokens: options?.maxTokens ?? 4096,
    temperature: options?.temperature ?? 0.3,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const textBlocks = response.content.filter(
    (block): block is Anthropic.TextBlock => block.type === 'text',
  );

  return textBlocks.map((b) => b.text).join('\n');
}
