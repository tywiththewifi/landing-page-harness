import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { SiteMcp } from "@lph/tokens";
import type { SiteData, SiteFact } from "./schema.ts";
import { describeTool, toolUse, type ToolInfo } from "./site-tools.ts";

/**
 * Reads a site's own data from its MCP server: plans, prices, help articles, anything
 * the company already exposes to agents. The brief treats the answers like site copy:
 * claims can cite them, and numbers in them count as sourced.
 *
 * Which tools get called is decided by toolUse (site-tools.ts): read-only ones only.
 */

export interface McpOptions {
  /** Tools a person allowed although the server doesn't mark them read-only. */
  allowed?: string[];
  /** Sent as a bearer token. Servers that need OAuth aren't supported yet. */
  token?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const MAX_FACT = 4000;
const MAX_TOTAL = 20000;
const MAX_TOOLS = 6;
const MAX_RESOURCES = 5;

async function connect(url: string, opts: McpOptions) {
  const client = new Client({ name: "softlander", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: opts.token ? { headers: { authorization: `Bearer ${opts.token}` } } : undefined,
    // A server that redirects could point Softlander at an internal address, so redirects fail.
    fetch: (input, init) => (opts.fetch ?? fetch)(input, { ...init, redirect: "error" }),
  });
  await client.connect(transport, { timeout: opts.timeoutMs ?? 15_000 });
  return client;
}

async function listAll(client: Client, opts: McpOptions) {
  const timeout = { timeout: opts.timeoutMs ?? 15_000 };
  const caps = client.getServerCapabilities() ?? {};
  const tools = caps.tools ? ((await client.listTools(undefined, timeout)).tools as ToolInfo[]) : [];
  const resources = caps.resources ? (await client.listResources(undefined, timeout)).resources : [];
  return { tools, resources };
}

/** Connects, and lists what the server offers and what Softlander would do with each tool. */
export async function inspectMcp(url: string, opts: McpOptions = {}): Promise<SiteMcp> {
  const client = await connect(url, opts);
  try {
    const info = client.getServerVersion();
    const { tools, resources } = await listAll(client, opts);
    return {
      url,
      name: info?.title ?? info?.name ?? new URL(url).host,
      version: info?.version ?? null,
      tools: tools.map((t) => describeTool(t, opts.allowed)),
      resources: resources.map((r) => ({ uri: r.uri, name: r.title ?? r.name })),
      allowed: (opts.allowed ?? []).filter((name) => tools.some((t) => t.name === name)),
      checkedAt: new Date().toISOString(),
    };
  } finally {
    await client.close().catch(() => {});
  }
}

/** Text answers only, with anything that could close the brief's data tags neutralised. */
const clean = (text: string) => {
  const t = text.replace(/<\/?site_data/gi, "‹site_data").trim();
  return t.length > MAX_FACT ? `${t.slice(0, MAX_FACT)}…` : t;
};

/**
 * Asks the server about the topic: calls the usable read-only tools and reads text
 * resources. Failures become notes; the brief is still written from the site copy.
 */
export async function collectSiteData(url: string, topic: string, opts: McpOptions = {}): Promise<SiteData> {
  const notes: string[] = [];
  const facts: SiteFact[] = [];
  let total = 0;
  const add = (fact: SiteFact) => {
    if (!fact.text || total >= MAX_TOTAL) return;
    total += fact.text.length;
    facts.push(fact);
  };
  const client = await connect(url, opts);
  try {
    const info = client.getServerVersion();
    const name = info?.title ?? info?.name ?? new URL(url).host;
    const { tools, resources } = await listAll(client, opts);
    const usable = tools.map((t) => ({ t, ...toolUse(t, opts.allowed?.includes(t.name)) })).filter((x) => x.use);
    for (const { t, use, arg } of usable.slice(0, MAX_TOOLS)) {
      try {
        const res = await client.callTool({ name: t.name, arguments: use === "query" ? { [arg!]: topic } : {} }, undefined, { timeout: opts.timeoutMs ?? 15_000 });
        const text = ((res.content ?? []) as { type: string; text?: string }[])
          .filter((c) => c.type === "text" && c.text)
          .map((c) => c.text)
          .join("\n");
        if (res.isError) notes.push(`${t.title ?? t.name} returned an error: ${clean(text).slice(0, 200)}`);
        else add({ source: `tool:${t.name}`, label: t.title ?? t.annotations?.title ?? t.name, text: clean(text) });
      } catch (err) {
        notes.push(`${t.title ?? t.name} failed (${(err as Error).message}).`);
      }
    }
    const textual = resources.filter((r) => !r.mimeType || /^text\/|json|xml|markdown/.test(r.mimeType));
    for (const r of textual.slice(0, MAX_RESOURCES)) {
      try {
        const { contents } = await client.readResource({ uri: r.uri }, { timeout: opts.timeoutMs ?? 15_000 });
        const text = contents.map((c) => ("text" in c && typeof c.text === "string" ? c.text : "")).join("\n");
        add({ source: `resource:${r.uri}`, label: r.title ?? r.name, text: clean(text) });
      } catch (err) {
        notes.push(`Couldn't read ${r.name} (${(err as Error).message}).`);
      }
    }
    const skipped = tools.length - usable.length;
    if (skipped) notes.push(`${skipped} tool${skipped === 1 ? " was" : "s were"} skipped: not read-only, or ${skipped === 1 ? "it needs" : "they need"} inputs Softlander can't fill.`);
    return { server: { name, url }, facts, notes };
  } finally {
    await client.close().catch(() => {});
  }
}
