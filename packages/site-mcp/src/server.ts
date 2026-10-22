import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { normalizePath } from "./extract.ts";
import { SiteIndex } from "./search.ts";
import type { Page, PageType, Snapshot } from "./types.ts";

const PAGE_TYPES = ["home", "case-study", "article", "press", "event", "product", "integration", "careers", "legal", "contact", "page"] as const;

export interface ServerOptions {
  snapshot: Snapshot;
  /** A brand kit directory written by `pnpm extract` (DESIGN.md, tokens.css, tokens.json). */
  brandDir?: string;
}

/**
 * An MCP server for a site that has none: read-only tools over a crawled
 * snapshot, plus the brand kit when one has been imported.
 */
export function createSiteServer({ snapshot, brandDir }: ServerOptions): McpServer {
  const host = new URL(snapshot.origin).hostname;
  const server = new McpServer({ name: `site-mcp:${host}`, version: "0.1.0" });
  const index = new SiteIndex(snapshot.pages);
  const byPath = new Map(snapshot.pages.map((p) => [p.path, p]));

  const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
  const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
  const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });
  const summary = (p: Page) => ({ url: p.url, type: p.type, lang: p.lang, title: p.title, description: p.description });

  server.registerTool(
    "site_overview",
    {
      title: `About ${snapshot.name}`,
      description: `What this server knows about ${snapshot.origin}: page counts by type and language, when it was crawled, what was skipped, and whether a brand kit is available. Call this first.`,
      inputSchema: {},
    },
    async () => {
      const count = (key: (p: Page) => string) =>
        snapshot.pages.reduce<Record<string, number>>((acc, p) => ((acc[key(p)] = (acc[key(p)] ?? 0) + 1), acc), {});
      const skipped = snapshot.skipped.reduce<Record<string, number>>((acc, s) => ((acc[s.reason] = (acc[s.reason] ?? 0) + 1), acc), {});
      return json({
        name: snapshot.name,
        origin: snapshot.origin,
        crawledAt: snapshot.crawledAt,
        pages: snapshot.pages.length,
        byType: count((p) => p.type),
        byLanguage: count((p) => p.lang),
        skipped,
        brandKit: Boolean(brandDir),
        note: "Content is a snapshot of public pages. Cite page URLs when quoting; do not treat it as an official statement from the site owner.",
      });
    },
  );

  server.registerTool(
    "search_site",
    {
      title: "Search the site",
      description: "Keyword search across every crawled page. Returns ranked pages with a matching snippet; use get_page to read one.",
      inputSchema: {
        query: z.string().min(1),
        type: z.enum(PAGE_TYPES).optional().describe("Only pages of this type"),
        lang: z.string().optional().describe("Two-letter language code, e.g. en"),
        limit: z.number().int().min(1).max(25).optional(),
      },
    },
    async ({ query, type, lang, limit }) => json(index.search(query, { type, lang, limit })),
  );

  server.registerTool(
    "list_pages",
    {
      title: "List pages",
      description: "List crawled pages, optionally filtered by type, language or a path prefix.",
      inputSchema: {
        type: z.enum(PAGE_TYPES).optional(),
        lang: z.string().optional(),
        pathPrefix: z.string().optional().describe("e.g. /case-studies"),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
      },
    },
    async ({ type, lang, pathPrefix, limit = 50, offset = 0 }) => {
      const all = snapshot.pages.filter(
        (p) => (!type || p.type === type) && (!lang || p.lang === lang) && (!pathPrefix || p.path.startsWith(pathPrefix)),
      );
      return json({ total: all.length, offset, pages: all.slice(offset, offset + limit).map(summary) });
    },
  );

  server.registerTool(
    "get_page",
    {
      title: "Read a page",
      description: "Read one page as Markdown (main content only, no navigation or footer), with its title, description, key figures and last-modified date.",
      inputSchema: {
        page: z.string().describe("A full URL on this site or a path like /case-studies/acme"),
        maxChars: z.number().int().min(500).max(100_000).optional(),
      },
    },
    async ({ page, maxChars = 20_000 }) => {
      const p = lookup(page);
      if (!p) return fail(`No page ${page} in the snapshot. Use search_site or list_pages to find one.`);
      const body = p.markdown.length > maxChars ? p.markdown.slice(0, maxChars) + "\n\n[truncated]" : p.markdown;
      const head = [
        `# ${p.title}`,
        `URL: ${p.url}`,
        `Type: ${p.type} · Language: ${p.lang}${p.lastModified ? ` · Last modified: ${p.lastModified}` : ""}`,
        p.description && `> ${p.description}`,
        p.stats.length ? `Key figures:\n${p.stats.map((s) => `- ${s}`).join("\n")}` : "",
      ].filter(Boolean);
      return text(`${head.join("\n\n")}\n\n---\n\n${body}`);
    },
  );

  server.registerTool(
    "list_case_studies",
    {
      title: "Customer case studies",
      description: "Customer stories with the customer's name, summary and headline figures, for proof points in briefs and landing pages.",
      inputSchema: { lang: z.string().optional() },
    },
    async ({ lang = "en" }) =>
      json(
        snapshot.pages
          .filter((p) => p.type === "case-study" && p.lang === lang && p.path.split("/").filter(Boolean).length > 1)
          .map((p) => ({ customer: customerName(p), url: p.url, summary: p.description, figures: p.stats })),
      ),
  );

  if (brandDir) {
    server.registerTool(
      "get_brand",
      {
        title: "Brand kit",
        description: "The site's measured design system from the brand import: DESIGN.md (values and usage rules for agents), tokens.css or tokens.json (W3C design tokens).",
        inputSchema: { format: z.enum(["design_md", "tokens_css", "tokens_json"]).optional() },
      },
      async ({ format = "design_md" }) => {
        const file = { design_md: "DESIGN.md", tokens_css: "tokens.css", tokens_json: "tokens.json" }[format];
        try {
          return text(await readFile(join(brandDir, file), "utf8"));
        } catch {
          return fail(`${file} not found in the brand kit.`);
        }
      },
    );
  }

  function lookup(ref: string): Page | undefined {
    let path = ref;
    try {
      const u = new URL(ref, snapshot.origin);
      if (u.hostname.replace(/^www\./, "") !== host.replace(/^www\./, "")) return undefined;
      path = u.pathname;
    } catch {
      // Treat as a path.
    }
    return byPath.get(normalizePath(path)) ?? byPath.get(normalizePath(decodeURIComponent(path)));
  }

  return server;
}

function customerName(p: Page): string {
  return p.title.replace(/\s*\|.*$/, "").replace(/\s*(customer\s+)?case stud(y|ies)\s*$/i, "").trim() || p.title;
}

export type { PageType };
