import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { classify, crawlSite, createSiteServer, extractPage, parseRobots, serveHttp, SiteIndex, type Snapshot } from "../src/index.ts";

const ORIGIN = "https://acme.test";

const layout = (title: string, body: string, extra = "") => `<!doctype html><html lang="en"><head>
<title>${title} | Acme | Acme</title><meta name="description" content="${title} description">${extra}</head>
<body><main><header class="fixed top-0"><a href="/">Acme</a><nav><a href="/platform">Platform</a></nav><button>Request a demo</button></header>
${body}<footer><a href="/">Home</a> © Acme</footer></main></body></html>`;

const SITE: Record<string, string> = {
  "/robots.txt": "User-agent: *\nDisallow: /admin/\nAllow: /admin/public\nSitemap: https://acme.test/sitemap.xml\n",
  "/sitemap.xml": `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://acme.test/pages.xml</loc></sitemap></sitemapindex>`,
  "/pages.xml": `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    ${["/", "/platform", "/case-studies", "/case-studies/globex", "/blog/grid-flex", "/admin/secret", "/admin/public", "/hidden", "https://other.test/x"]
      .map((p) => `<url><loc>${p.startsWith("http") ? p : ORIGIN + p}</loc><lastmod>2026-10-01</lastmod></url>`).join("")}
  </urlset>`,
  "/": layout("Home", `<h1>Billing for<br>utilities</h1><p>See <a href="/platform">the platform</a>.</p>`),
  "/platform": layout("Platform", `<h1>The platform</h1><p>Smart meter billing and customer service in one system.</p>`),
  "/case-studies": layout("Case studies", `<h1>Customers</h1>`),
  "/case-studies/globex": layout("Globex case study", `<h2>40%</h2><p>fewer support calls</p><h3>Smart meters at scale</h3><p>Globex moved 2 million accounts with zero downtime.</p><span class="md:hidden">mobile copy</span>`),
  "/blog/grid-flex": layout("Grid flexibility explained", `<h1>Grid flexibility</h1><p>Batteries and heat pumps can shift demand.</p>`),
  "/admin/public": layout("Admin docs", `<p>Public admin docs.</p>`),
  "/hidden": layout("Hidden", `<p>Nope</p>`, `<meta name="robots" content="noindex">`),
};

const fakeFetch = (async (input: string | URL | Request) => {
  const u = new URL(String(input));
  const body = u.origin === ORIGIN ? SITE[u.pathname] : undefined;
  if (body === undefined) return new Response("Not found", { status: 404 });
  const type = u.pathname.endsWith(".xml") ? "application/xml" : u.pathname.endsWith(".txt") ? "text/plain" : "text/html";
  return new Response(body, { headers: { "content-type": type } });
}) as typeof fetch;

describe("parseRobots", () => {
  it("uses the longest matching rule and supports wildcards", () => {
    const r = parseRobots("User-agent: *\nDisallow: /a/\nAllow: /a/b\nDisallow: /*.pdf$\n\nUser-agent: lph-site-mcp\nDisallow: /only-us\nCrawl-delay: 2", "lph-site-mcp/0.1");
    expect(r.allows("/only-us")).toBe(false);
    expect(r.allows("/a/x")).toBe(true); // our own group replaces the * group
    expect(r.crawlDelayMs).toBe(2000);
    const star = parseRobots("User-agent: *\nDisallow: /a/\nAllow: /a/b\nDisallow: /*.pdf$", "other");
    expect(star.allows("/a/x")).toBe(false);
    expect(star.allows("/a/b/c")).toBe(true);
    expect(star.allows("/doc.pdf")).toBe(false);
    expect(star.allows("/doc.pdf?x")).toBe(true);
  });
});

describe("classify", () => {
  it("types pages by URL, ignoring a language prefix", () => {
    expect(classify("/")).toBe("home");
    expect(classify("/ja")).toBe("home");
    expect(classify("/case-studies/x")).toBe("case-study");
    expect(classify("/ja/press-releases/x")).toBe("press");
    expect(classify("/marketplace/apps/stripe")).toBe("integration");
    expect(classify("/field", new Set(["/field"]))).toBe("product");
    expect(classify("/field")).toBe("page");
  });
});

describe("extractPage", () => {
  it("keeps main content and drops the site header, footer and mobile duplicates", () => {
    const p = extractPage(SITE["/case-studies/globex"]!, `${ORIGIN}/case-studies/globex/`);
    expect(p.path).toBe("/case-studies/globex");
    expect(p.title).toBe("Globex case study | Acme");
    expect(p.markdown).not.toMatch(/Request a demo|©|mobile copy/);
    expect(p.outline).toEqual(["## 40%", "### Smart meters at scale"]);
    expect(p.stats).toEqual(["40%: fewer support calls"]);
  });

  it("joins words split by <br>", () => {
    expect(extractPage(SITE["/"]!, `${ORIGIN}/`).markdown).toContain("# Billing for utilities");
  });
});

describe("crawlSite + MCP server", () => {
  it("crawls politely and answers MCP tool calls", async () => {
    const snapshot: Snapshot = await crawlSite({ url: ORIGIN, fetch: fakeFetch, delayMs: 0 });
    expect(snapshot.pages.map((p) => p.path)).toEqual(["/", "/admin/public", "/blog/grid-flex", "/case-studies", "/case-studies/globex", "/platform"]);
    expect(snapshot.skipped).toEqual(
      expect.arrayContaining([
        { url: `${ORIGIN}/admin/secret`, reason: "robots.txt" },
        { url: `${ORIGIN}/hidden`, reason: "noindex" },
      ]),
    );
    expect(snapshot.name).toBe("Acme");
    expect(snapshot.pages.find((p) => p.path === "/platform")?.type).toBe("product");
    expect(snapshot.pages.find((p) => p.path === "/platform")?.lastModified).toBe("2026-10-01");

    expect(new SiteIndex(snapshot.pages).search("smart meters")[0]?.path).toBe("/case-studies/globex");

    const server = createSiteServer({ snapshot });
    const client = new Client({ name: "test", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);

    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(["get_page", "list_case_studies", "list_pages", "search_site", "site_overview"]);
    expect((await client.listTools()).tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);

    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const res = await client.callTool({ name, arguments: args });
      return (res.content as { text: string }[])[0]!.text;
    };
    expect(JSON.parse(await call("site_overview")).byType["case-study"]).toBe(2);
    expect(JSON.parse(await call("list_case_studies"))).toEqual([
      { customer: "Globex", url: `${ORIGIN}/case-studies/globex`, summary: "Globex case study description", figures: ["40%: fewer support calls"] },
    ]);
    expect(await call("get_page", { page: `${ORIGIN}/platform/` })).toContain("Smart meter billing");
    expect(await call("get_page", { page: "https://evil.test/platform" })).toContain("No page");

    await client.close();

    // Same server by URL, over streamable HTTP.
    const http = await serveHttp({ snapshot }, { port: 0 });
    const remote = new Client({ name: "test-http", version: "0" });
    await remote.connect(new StreamableHTTPClientTransport(new URL(http.url)));
    const res = await remote.callTool({ name: "search_site", arguments: { query: "grid flexibility" } });
    expect(JSON.parse((res.content as { text: string }[])[0]!.text)[0].path).toBe("/blog/grid-flex");
    await remote.close();
    await new Promise((done) => http.server.close(done));
  });
});
