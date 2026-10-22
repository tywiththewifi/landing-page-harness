import { createServer, type Server } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createSiteServer, type ServerOptions } from "./server.ts";

/**
 * Serve the site over MCP streamable HTTP at `/mcp`, so a client can connect
 * by URL. Stateless: each POST gets its own server over the shared snapshot.
 */
export function serveHttp(opts: ServerOptions, { port = 8788, host = "127.0.0.1" } = {}): Promise<{ url: string; server: Server }> {
  const http = createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (path !== "/mcp") {
      res.writeHead(404).end("Not found");
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405, { allow: "POST" }).end("Method not allowed");
      return;
    }
    const server = createSiteServer(opts);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      if (!res.headersSent) res.writeHead(500).end((err as Error).message);
    }
  });
  return new Promise((ok) =>
    http.listen(port, host, () => {
      const addr = http.address();
      const p = typeof addr === "object" && addr ? addr.port : port;
      ok({ url: `http://${host}:${p}/mcp`, server: http });
    }),
  );
}
