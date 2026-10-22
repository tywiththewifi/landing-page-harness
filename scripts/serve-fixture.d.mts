export function serveFixture(opts?: { name?: string; port?: number }): Promise<{
  url: string;
  /** Every MCP tools/call the fixture answered, in order. */
  mcpCalls: { name: string; arguments: Record<string, unknown> }[];
  close: () => Promise<void>;
}>;
