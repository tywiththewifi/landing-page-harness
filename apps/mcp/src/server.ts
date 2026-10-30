import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Brief, BriefIssue } from "@lph/brief";
import type { GateReport } from "@lph/checks";
import type { Page, PageIssue } from "@lph/page";
import type { Brand } from "@lph/tokens";
import { ApiError, type ApiClient } from "./client.ts";
import { reportMarkdown, runFromUrl } from "./pipeline.ts";
import { brandSummary, briefSummary, gateSummary, pageSummary } from "./summary.ts";

const INSTRUCTIONS = `Softlander turns any website into on-brand landing pages with guardrails.

The fastest way to try it on a site is launch_from_url: it imports the brand from the site's rendered CSS, writes a brief, builds the page and runs the publish checks, and reports what each step found, with links to open.

Step by step: import_brand → (resolve_conflict) → write_brief → (update_brief until check has no errors) → build_page → (update_page) → run_checks → publish_plan → publish_page.

Rules Softlander keeps: brand values are always measured from the site, never invented. Numbers and quotes on a page must come from the site, its MCP data or the prompt. Text marked [To write] needs a person (or you) to write it before the page can publish. Errors block, unless the person chooses to publish anyway and gives a reason; warnings need a reviewer.`;

type Content = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (t: string): Content => ({ content: [{ type: "text", text: t }] });
const json = (value: unknown): Content => text(JSON.stringify(value, null, 2));

/** API errors become tool errors the agent can read and act on, rather than protocol failures. */
const safely =
  <A>(fn: (args: A) => Promise<Content>) =>
  async (args: A): Promise<Content> => {
    try {
      return await fn(args);
    } catch (err) {
      const detail = err instanceof ApiError && typeof err.body === "object" && err.body && "issues" in err.body ? `\n${JSON.stringify((err.body as { issues: unknown }).issues, null, 2)}` : "";
      return { ...text(`${err instanceof Error ? err.message : String(err)}${detail}`), isError: true };
    }
  };

const id = (what: string) => z.string().min(1).describe(`The ${what}'s id`);
const changes = (what: string) =>
  z.record(z.string(), z.unknown()).describe(`Top-level fields of the ${what} to replace, as returned with format "json". Fields you leave out stay as they are.`);

export function createServer(api: ApiClient, info: { version?: string } = {}) {
  const server = new McpServer({ name: "softlander", version: info.version ?? "0.1.0" }, { instructions: INSTRUCTIONS });

  const brandOut = (brand: Brand) => ({
    ...brandSummary(brand),
    links: { preview: api.link(`/api/brands/${brand.id}/preview.html`), designMd: api.link(`/api/brands/${brand.id}/design.md`), tokensCss: api.link(`/api/brands/${brand.id}/tokens.css`) },
  });
  const briefOut = async (brief: Brief) => ({
    ...briefSummary(brief, await api.json<BriefIssue[]>("GET", `/api/briefs/${brief.id}/check`)),
    links: { markdown: api.link(`/api/briefs/${brief.id}/brief.md`) },
  });
  const pageOut = async (page: Page) => ({
    ...pageSummary(page, await api.json<PageIssue[]>("GET", `/api/pages/${page.id}/check`)),
    links: {
      page: api.link(`/api/pages/${page.id}/page.html`),
      ...Object.fromEntries(page.variants.map((v) => [v.slug, api.link(`/api/pages/${page.id}/page.html?version=${encodeURIComponent(v.slug)}`)])),
    },
  });

  server.registerTool(
    "launch_from_url",
    {
      title: "Try Softlander on a website",
      description:
        "Runs a website through every step: imports its brand (about 15 to 30 seconds in a real browser), writes a brief, builds a landing page with a version per persona, and runs the publish checks (brand, SEO, accessibility, performance). Stops at the first step that fails and says why. Returns a Markdown report and the ids to keep working with the other tools.",
      inputSchema: {
        url: z.string().min(1).describe("The site's home page, e.g. https://example.com"),
        prompt: z.string().optional().describe('What the page is for, e.g. "Landing page for our HubSpot integration for ops managers". Defaults to a page about the brand.'),
        productUrl: z.string().optional().describe("The main product page. Defaults to the most product-like link in the header."),
        runChecks: z.boolean().optional().describe("Run the publish checks at the end. Defaults to true."),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    safely(async ({ url, prompt, productUrl, runChecks }) => {
      const report = await runFromUrl(api, { url: /^https?:\/\//.test(url) ? url : `https://${url}`, prompt, productUrl, gate: runChecks });
      const ids = { brandId: report.brand?.id, briefId: report.brief?.id, pageId: report.page?.id };
      return { content: [{ type: "text", text: reportMarkdown(report) }, { type: "text", text: JSON.stringify(ids) }], ...(report.reached === null && { isError: true }) };
    }),
  );

  server.registerTool(
    "import_brand",
    {
      title: "Import a brand",
      description:
        "Opens a website's home page and main product page in a headless browser and measures its design system: colours, type, buttons, cards, radius, spacing, logo and copy. Every value is measured, with a confidence; conflicts (two body fonts, say) are listed for a decision. Takes 15 to 30 seconds.",
      inputSchema: { url: z.string().min(1).describe("The site's home page"), productUrl: z.string().optional().describe("The main product page, if the header doesn't link to it") },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    safely(async ({ url, productUrl }) => json(brandOut(await api.json<Brand>("POST", "/api/brands?wait=true", { url: /^https?:\/\//.test(url) ? url : `https://${url}`, productUrl })))),
  );

  server.registerTool(
    "list_brands",
    { title: "List brands", description: "Brands imported so far, most recent first.", annotations: { readOnlyHint: true } },
    safely(async () => json(await api.json("GET", "/api/brands"))),
  );

  server.registerTool(
    "get_brand",
    {
      title: "Read a brand",
      description: 'A brand as a summary, DESIGN.md (the brand written for agents: values, usage rules, contrast), tokens.css, DTCG tokens.json, its contrast checks, or the full record with every value\'s sources ("json").',
      inputSchema: { brandId: id("brand"), format: z.enum(["summary", "design.md", "tokens.css", "tokens.json", "contrast", "json"]).default("summary") },
      annotations: { readOnlyHint: true },
    },
    safely(async ({ brandId, format }) => {
      const base = `/api/brands/${encodeURIComponent(brandId)}`;
      if (format === "summary") return json(brandOut(await api.json<Brand>("GET", base)));
      if (format === "json") return json(await api.json("GET", base));
      if (format === "tokens.json" || format === "contrast") return json(await api.json("GET", `${base}/${format}`));
      return text(await api.text(`${base}/${format}`));
    }),
  );

  server.registerTool(
    "resolve_conflict",
    {
      title: "Resolve a brand conflict",
      description: "Picks one of a conflict's measured options (see the conflicts in a brand summary). Only measured options are accepted.",
      inputSchema: { brandId: id("brand"), conflictId: z.string().min(1), value: z.string().min(1).describe("One of the conflict's options") },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    safely(async ({ brandId, conflictId, value }) => json(brandOut(await api.json<Brand>("POST", `/api/brands/${encodeURIComponent(brandId)}/conflicts/${encodeURIComponent(conflictId)}`, { value })))),
  );

  server.registerTool(
    "write_brief",
    {
      title: "Write a brief",
      description:
        "Turns a prompt into a marketing brief grounded in the brand's site: objective and KPI, personas, funnel stage, channels, messages, offer and CTA, sourced proof points, page outline and SEO/AEO targets. Returns a summary with the consistency check; errors must be fixed (update_brief) before a page can be built.",
      inputSchema: {
        brandId: id("brand"),
        prompt: z.string().min(3).describe('e.g. "Landing page for our new HubSpot integration for ops managers"'),
        seoProvider: z.string().optional().describe("An SEO/AEO provider id from the server's settings. Defaults to the connected one, or best practices."),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    safely(async ({ brandId, prompt, seoProvider }) => json(await briefOut(await api.json<Brief>("POST", `/api/brands/${encodeURIComponent(brandId)}/briefs?wait=true`, { prompt, seoProvider })))),
  );

  server.registerTool(
    "get_brief",
    {
      title: "Read a brief",
      description: 'A brief as a summary with its check, as Markdown, or as the full editable record ("json").',
      inputSchema: { briefId: id("brief"), format: z.enum(["summary", "markdown", "json"]).default("summary") },
      annotations: { readOnlyHint: true },
    },
    safely(async ({ briefId, format }) => {
      const base = `/api/briefs/${encodeURIComponent(briefId)}`;
      if (format === "markdown") return text(await api.text(`${base}/brief.md`));
      const brief = await api.json<Brief>("GET", base);
      return json(format === "json" ? brief : await briefOut(brief));
    }),
  );

  server.registerTool(
    "update_brief",
    {
      title: "Edit a brief",
      description: 'Replaces top-level fields of a brief (e.g. "offer", "personas", "seo", "proofPoints") and returns the new check. Read the brief with format "json" first and send whole fields back.',
      inputSchema: { briefId: id("brief"), changes: changes("brief") },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    safely(async ({ briefId, changes }) => {
      const path = `/api/briefs/${encodeURIComponent(briefId)}`;
      const current = await api.json<Brief>("GET", path);
      return json(await briefOut(await api.json<Brief>("PUT", path, { ...current, ...changes })));
    }),
  );

  server.registerTool(
    "build_page",
    {
      title: "Build the page",
      description: "Builds a landing page from a brief using the brand's starter components, with a version per persona on its own URL. Returns a summary with the page's check and preview links.",
      inputSchema: { briefId: id("brief") },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    safely(async ({ briefId }) => json(await pageOut(await api.json<Page>("POST", `/api/briefs/${encodeURIComponent(briefId)}/pages?wait=true`)))),
  );

  server.registerTool(
    "get_page",
    {
      title: "Read a page",
      description: 'A page as a summary with its check and preview links, the full editable record ("json"), or the HTML that would be published ("html", optionally for one persona\'s version).',
      inputSchema: { pageId: id("page"), format: z.enum(["summary", "json", "html"]).default("summary"), version: z.string().optional().describe("A version's slug, for html") },
      annotations: { readOnlyHint: true },
    },
    safely(async ({ pageId, format, version }) => {
      const base = `/api/pages/${encodeURIComponent(pageId)}`;
      if (format === "html") return text(await api.text(`${base}/page.html${version ? `?version=${encodeURIComponent(version)}` : ""}`));
      const page = await api.json<Page>("GET", base);
      return json(format === "json" ? page : await pageOut(page));
    }),
  );

  server.registerTool(
    "update_page",
    {
      title: "Edit a page",
      description:
        'Replaces top-level fields of a page ("blocks", "variants", "seo", "title", "slug", "form") and returns the new check. Editing is constrained: copy and the props each block allows, within the brand\'s tokens. Read the page with format "json" first and send whole fields back.',
      inputSchema: { pageId: id("page"), changes: changes("page") },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    safely(async ({ pageId, changes }) => {
      const path = `/api/pages/${encodeURIComponent(pageId)}`;
      const current = await api.json<Page>("GET", path);
      return json(await pageOut(await api.json<Page>("PUT", path, { ...current, ...changes })));
    }),
  );

  server.registerTool(
    "run_checks",
    {
      title: "Run the publish checks",
      description: "Renders every version as it will go live and checks it: content, brand, SEO and answer engines, accessibility (axe, WCAG 2.2 AA) and a performance budget in Chromium. Verdict: blocked (errors), review (warnings need a person) or ready.",
      inputSchema: { pageId: id("page") },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    safely(async ({ pageId }) => json(gateSummary(await api.json<GateReport>("POST", `/api/pages/${encodeURIComponent(pageId)}/gate?wait=true`)))),
  );

  server.registerTool(
    "publish_plan",
    {
      title: "Preview publishing",
      description: "What publishing would do now, without doing it: the files, the risk (copy-only changes merge themselves, the rest goes to a reviewer), the pull request's description and where it would go.",
      inputSchema: { pageId: id("page") },
      annotations: { readOnlyHint: true },
    },
    safely(async ({ pageId }) => json(await api.json("GET", `/api/pages/${encodeURIComponent(pageId)}/publish`))),
  );

  server.registerTool(
    "publish_page",
    {
      title: "Publish the page",
      description:
        "Opens (or updates) a pull request with the page in the company's site repo. Needs the checks to have run on this version of the page, and a site repo set up on the server. If the checks found errors, it only publishes with overrideReason, which only the person can decide on: the pull request is then labelled lph:override, waits for a reviewer and fails the site's checks. Confirm with the person before calling this.",
      inputSchema: {
        pageId: id("page"),
        overrideReason: z.string().max(500).optional().describe("Publish although the checks found errors, for this reason. Only when the person asked for it, in their words."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    safely(async ({ pageId, overrideReason }) =>
      json(await api.json("POST", `/api/pages/${encodeURIComponent(pageId)}/publish`, overrideReason?.trim() ? { override: { reason: overrideReason } } : {})),
    ),
  );

  // Brands as resources, so a client can attach a brand's DESIGN.md or tokens to a conversation.
  const brandResource = (file: "design.md" | "tokens.css", mimeType: string) =>
    server.registerResource(
      `brand-${file}`,
      new ResourceTemplate(`lph://brands/{brandId}/${file}`, {
        list: async () => ({
          resources: (await api.json<{ id: string; name: string }[]>("GET", "/api/brands")).map((b) => ({ uri: `lph://brands/${b.id}/${file}`, name: `${b.name} ${file}`, mimeType })),
        }),
      }),
      { title: `A brand's ${file}`, mimeType },
      async (uri, { brandId }) => ({ contents: [{ uri: uri.href, mimeType, text: await api.text(`/api/brands/${encodeURIComponent(String(brandId))}/${file}`) }] }),
    );
  brandResource("design.md", "text/markdown");
  brandResource("tokens.css", "text/css");

  return server;
}
