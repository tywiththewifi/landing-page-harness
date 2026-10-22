// Serves a fixture site (default: fixtures/northloop) for local runs and tests.
// If the fixture has an mcp.json, the site also answers MCP requests at /mcp.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TYPES = { ".html": "text/html", ".css": "text/css", ".svg": "image/svg+xml", ".js": "text/javascript" };

/**
 * A minimal MCP server (streamable HTTP, JSON responses, no sessions) over the
 * fixture's mcp.json. Every tools/call is logged so tests can check what was called.
 */
async function handleMcp(req, res, mcp, calls) {
  if (req.method !== "POST") return res.writeHead(405, { allow: "POST" }).end();
  let body = "";
  for await (const chunk of req) body += chunk;
  const messages = [].concat(JSON.parse(body));
  const answers = [];
  for (const { id, method, params = {} } of messages) {
    if (id === undefined) continue; // notifications
    const ok = (result) => answers.push({ jsonrpc: "2.0", id, result });
    const fail = (code, message) => answers.push({ jsonrpc: "2.0", id, error: { code, message } });
    const tool = method === "tools/call" ? mcp.tools.find((t) => t.name === params.name) : null;
    if (method === "initialize") {
      ok({ protocolVersion: params.protocolVersion, capabilities: { tools: {}, resources: {} }, serverInfo: mcp.server });
    } else if (method === "ping") {
      ok({});
    } else if (method === "tools/list") {
      ok({ tools: mcp.tools.map(({ text, articles, ...t }) => t) });
    } else if (method === "tools/call") {
      if (!tool) {
        fail(-32602, `Unknown tool ${params.name}`);
        continue;
      }
      calls.push({ name: tool.name, arguments: params.arguments ?? {} });
      let text = tool.text;
      if (tool.articles) {
        const words = String(params.arguments?.query ?? "").toLowerCase().split(/\W+/).filter((w) => w.length > 2);
        const hits = tool.articles.filter((a) => words.some((w) => `${a.title} ${a.text}`.toLowerCase().includes(w)));
        text = (hits.length ? hits : tool.articles.slice(0, 2)).map((a) => `${a.title}: ${a.text}`).join("\n");
      }
      ok({ content: [{ type: "text", text }] });
    } else if (method === "resources/list") {
      ok({ resources: mcp.resources.map(({ text, ...r }) => r) });
    } else if (method === "resources/read") {
      const r = mcp.resources.find((x) => x.uri === params.uri);
      if (r) ok({ contents: [{ uri: r.uri, mimeType: r.mimeType, text: r.text }] });
      else fail(-32602, `Unknown resource ${params.uri}`);
    } else {
      fail(-32601, `Method not found: ${method}`);
    }
  }
  if (!answers.length) return res.writeHead(202).end();
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(Array.isArray(JSON.parse(body)) ? answers : answers[0]));
}

export function serveFixture({ name = "northloop", port = 0 } = {}) {
  const root = resolve(fileURLToPath(new URL("../fixtures/", import.meta.url)), name);
  const mcpCalls = [];
  const mcp = readFile(join(root, "mcp.json"), "utf8").then(JSON.parse, () => null);
  const server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    if (pathname === "/mcp" && (await mcp)) return handleMcp(req, res, await mcp, mcpCalls);
    const rel = normalize(pathname.endsWith("/") ? pathname + "index.html" : pathname).replace(/^(\.\.[/\\])+/, "");
    try {
      const body = await readFile(join(root, rel));
      res.writeHead(200, { "content-type": TYPES[extname(rel)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("Not found");
    }
  });
  return new Promise((ok) =>
    server.listen(port, "127.0.0.1", () => {
      const { port: p } = server.address();
      ok({ url: `http://127.0.0.1:${p}/`, mcpCalls, close: () => new Promise((done) => server.close(done)) });
    }),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { url } = await serveFixture({ port: Number(process.env.PORT ?? 4319) });
  console.log(`Fixture site at ${url}`);
}
