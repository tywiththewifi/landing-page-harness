#!/usr/bin/env -S npx tsx
/**
 * lph-site-mcp crawl <url> [--out <file>] [--max <n>] [--include /path]... [--lang en]...
 * lph-site-mcp serve <snapshot.json> [--brand <dir>] [--http <port>]
 *
 * `crawl` writes a snapshot of a site's public pages; `serve` exposes it as
 * an MCP server over stdio (or streamable HTTP at /mcp with --http), for
 * Claude, Cursor or any other MCP client.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { crawlSite } from "./crawl.ts";
import { serveHttp } from "./http.ts";
import { createSiteServer } from "./server.ts";
import type { Snapshot } from "./types.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string" },
    max: { type: "string" },
    include: { type: "string", multiple: true },
    lang: { type: "string", multiple: true },
    delay: { type: "string" },
    brand: { type: "string" },
    http: { type: "string" },
  },
});

const [command, target] = positionals;

if (command === "crawl" && target) {
  const snapshot = await crawlSite({
    url: target,
    maxPages: values.max ? Number(values.max) : undefined,
    include: values.include,
    langs: values.lang,
    delayMs: values.delay ? Number(values.delay) : undefined,
    onProgress: (m) => console.error(`• ${m}`),
  });
  const out = resolve(values.out ?? `sites/${new URL(snapshot.origin).hostname}.json`);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(snapshot, null, 2));
  console.error(`\n${snapshot.pages.length} pages, ${snapshot.skipped.length} skipped. Wrote ${out}`);
} else if (command === "serve" && target) {
  const snapshot = JSON.parse(await readFile(target, "utf8")) as Snapshot;
  const opts = { snapshot, brandDir: values.brand ? resolve(values.brand) : undefined };
  if (values.http) {
    const { url } = await serveHttp(opts, { port: Number(values.http) });
    console.error(`MCP server for ${snapshot.origin} at ${url}`);
  } else {
    await createSiteServer(opts).connect(new StdioServerTransport());
  }
} else {
  console.error("Usage:\n  lph-site-mcp crawl <url> [--out file] [--max n] [--include /path] [--lang en]\n  lph-site-mcp serve <snapshot.json> [--brand dir] [--http port]");
  process.exit(1);
}
