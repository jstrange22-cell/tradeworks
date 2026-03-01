/**
 * Shared MCP tool interface used by all tool server files.
 *
 * Each tool is defined as a self-contained object that the Claude Agent SDK
 * orchestrator can register with its MCP server. The `inputSchema` follows
 * JSON Schema draft-07 so it can be passed directly to the SDK's tool
 * definition without transformation.
 */
export interface MCPTool {
  /** Unique tool name (snake_case, e.g. "compute_indicators") */
  name: string;

  /** Human-readable description shown to the agent */
  description: string;

  /**
   * JSON Schema describing the tool's input parameters.
   * Must include `type: 'object'` at the top level with `properties`
   * and an optional `required` array.
   */
  inputSchema: Record<string, unknown>;

  /**
   * Async handler that receives validated params and returns a result.
   * The orchestrator serialises the return value as JSON for the agent.
   */
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}
