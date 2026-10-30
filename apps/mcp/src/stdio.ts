#!/usr/bin/env -S npx tsx
/**
 * Softlander as an MCP server over stdio, for Claude Desktop, Claude Code, Cursor or any MCP client.
 * With LPH_API_URL set it talks to that API; otherwise it runs the API itself (see .env.example).
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { connectApi } from "./local.ts";
import { createServer } from "./server.ts";

// stdout carries the protocol, so anything else logged goes to stderr.
console.log = console.error;

const { api, summary, close } = await connectApi();
for (const line of summary) console.error(line);

const server = createServer(api);
await server.connect(new StdioServerTransport());

const shutdown = async () => {
  await server.close();
  await close();
  process.exit(0);
};
process.stdin.on("close", shutdown);
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
