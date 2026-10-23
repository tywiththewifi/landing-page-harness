import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage } from "node:http";
import { GenerationError, templateGenerator, type Brief, type BriefIssue, type SeoProvider } from "@lph/brief";
import { verifyWebhook } from "@lph/forms";
import { templatePageGenerator, type Page, type PageIssue } from "@lph/page";
import type { Brand } from "@lph/tokens";
import { serveFixture } from "../../../scripts/serve-fixture.mjs";
import { createApp } from "../src/app.ts";
import { BrandStore, BriefStore, PageStore, SubmissionStore } from "../src/store.ts";
import { assertPublicUrl } from "../src/url-guard.ts";

describe("assertPublicUrl", () => {
  it("rejects internal addresses and non-http schemes", async () => {
    await expect(assertPublicUrl("http://127.0.0.1:8080/", false)).rejects.toThrow(/private/);
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data", false)).rejects.toThrow(/private/);
    await expect(assertPublicUrl("http://[::1]/", false)).rejects.toThrow(/private/);
    await expect(assertPublicUrl("file:///etc/passwd", false)).rejects.toThrow(/http/);
    await expect(assertPublicUrl("not a url", false)).rejects.toThrow(/URL/);
  });
});

describe("API", () => {
  let site: Awaited<ReturnType<typeof serveFixture>>;
  let dir: string;
  let app: ReturnType<typeof createApp>;
  let brand: Brand;

  beforeAll(async () => {
    site = await serveFixture();
    dir = await mkdtemp(join(tmpdir(), "lph-api-"));
    app = createApp({
      store: new BrandStore(join(dir, "brands")),
      briefs: new BriefStore(join(dir, "briefs")),
      pages: new PageStore(join(dir, "pages")),
      submissions: new SubmissionStore(join(dir, "submissions")),
      generator: templateGenerator(),
      pageGenerator: templatePageGenerator(),
      formSecrets: { webhookSecret: "test-secret" },
      outputDir: join(dir, "out"),
      allowPrivateUrls: true,
    });
  });
  afterAll(async () => {
    await site.close();
    await rm(dir, { recursive: true, force: true });
  });

  const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("imports a brand synchronously with ?wait=true", async () => {
    const res = await app.request("/api/brands?wait=true", json({ url: site.url }));
    expect(res.status).toBe(201);
    brand = await res.json();
    expect(brand.name).toBe("Northloop");
  });

  it("imports asynchronously and reports progress through a job", async () => {
    const res = await app.request("/api/brands", json({ url: site.url, productUrl: `${site.url}platform.html` }));
    expect(res.status).toBe(202);
    const job = await res.json();
    let status = job;
    for (let i = 0; i < 100 && status.status === "running"; i++) {
      await new Promise((r) => setTimeout(r, 100));
      status = await (await app.request(`/api/jobs/${job.id}`)).json();
    }
    expect(status.status).toBe("done");
    expect(status.brandId).toBeTruthy();
  });

  it("serves tokens, Design.md and contrast checks", async () => {
    const css = await (await app.request(`/api/brands/${brand.id}/tokens.css`)).text();
    expect(css).toContain("--color-brand: #1a3e35;");
    const md = await (await app.request(`/api/brands/${brand.id}/design.md`)).text();
    expect(md).toContain("# Northloop design system");
    const contrast = await (await app.request(`/api/brands/${brand.id}/contrast`)).json();
    expect(contrast.length).toBeGreaterThan(3);
  });

  it("saves Theme edits and rejects invalid values", async () => {
    const edited = structuredClone(brand);
    edited.colors[0]!.value = "#fafafa";
    edited.id = "something-else";
    const res = await app.request(`/api/brands/${brand.id}`, { ...json(edited), method: "PUT" });
    expect(res.status).toBe(200);
    const saved: Brand = await res.json();
    expect(saved.id).toBe(brand.id);
    expect(saved.colors[0]!.value).toBe("#fafafa");

    edited.colors[0]!.value = "red";
    const bad = await app.request(`/api/brands/${brand.id}`, { ...json(edited), method: "PUT" });
    expect(bad.status).toBe(400);
  });

  it("resolves conflicts", async () => {
    const res = await app.request(`/api/brands/${brand.id}/conflicts/fonts.body`, json({ value: "Inter" }));
    expect(res.status).toBe(200);
    expect((await res.json()).fonts.body).toBe("Inter");
    const bad = await app.request(`/api/brands/${brand.id}/conflicts/fonts.body`, json({ value: "Comic Sans" }));
    expect(bad.status).toBe(400);
  });

  it("writes the brand kit on confirm", async () => {
    const res = await app.request(`/api/brands/${brand.id}/confirm`, { method: "POST" });
    const { dir: out } = await res.json();
    expect((await readdir(out)).sort()).toEqual(["DESIGN.md", "brand.json", "logo.svg", "preview.html", "tokens.css", "tokens.json"]);
  });

  describe("briefs", () => {
    let brief: Brief;
    const prompt = "Landing page for our new HubSpot integration for ops managers";

    it("lists the SEO providers and the brief writer", async () => {
      expect(await (await app.request("/api/seo/providers")).json()).toEqual([expect.objectContaining({ id: "best-practices" })]);
      expect(await (await app.request("/api/generator")).json()).toEqual({ name: "template", model: null, page: { name: "template", model: null } });
    });

    it("writes a brief grounded in the imported site", async () => {
      const res = await app.request(`/api/brands/${brand.id}/briefs?wait=true`, json({ prompt }));
      expect(res.status).toBe(201);
      brief = await res.json();
      expect(brief).toMatchObject({ brandId: brand.id, prompt, funnelStage: "consideration", generator: { name: "template" } });
      expect(brief.personas[0]!.id).toBe("ops-managers");
      expect(brief.outline[0]!.type).toBe("hero");
      // The site's own button and proof, read during import.
      expect(brief.offer.primaryCta).toMatch(/Book a demo|Start free/);
      expect(brief.proofPoints.filter((p) => p.source === "site").map((p) => p.claim)).toContain("Trusted by 400 ops teams");
      expect(brief.insights.provider).toBe("best-practices");
    });

    it("runs as a job and lists briefs per brand", async () => {
      const job = await (await app.request(`/api/brands/${brand.id}/briefs`, json({ prompt: "Northloop vs Zapier comparison" }))).json();
      let status = job;
      for (let i = 0; i < 50 && status.status === "running"; i++) {
        await new Promise((r) => setTimeout(r, 20));
        status = await (await app.request(`/api/jobs/${job.id}`)).json();
      }
      expect(status).toMatchObject({ status: "done", brandId: brand.id });
      const list = await (await app.request(`/api/brands/${brand.id}/briefs`)).json();
      expect(list.map((b: Brief) => b.id)).toEqual(expect.arrayContaining([brief.id, status.briefId]));
    });

    it("saves edits but keeps the prompt, ids and keyword data", async () => {
      const edited = { ...structuredClone(brief), title: "HubSpot sync", prompt: "changed", brandId: "other", objective: { ...brief.objective, kpi: { ...brief.objective.kpi, target: "40 demos a month" } } };
      const res = await app.request(`/api/briefs/${brief.id}`, { ...json(edited), method: "PUT" });
      expect(res.status).toBe(200);
      const saved: Brief = await res.json();
      expect(saved).toMatchObject({ title: "HubSpot sync", prompt, brandId: brand.id });
      expect(saved.insights).toEqual(brief.insights);

      const bad = await app.request(`/api/briefs/${brief.id}`, { ...json({ ...edited, funnelStage: "viral" }), method: "PUT" });
      expect(bad.status).toBe(400);
    });

    it("checks the brief and exports it as Markdown", async () => {
      const issues: BriefIssue[] = await (await app.request(`/api/briefs/${brief.id}/check`)).json();
      expect(issues.some((i) => i.severity === "error")).toBe(false);
      expect(issues.map((i) => i.id)).not.toContain("objective.kpi-target");
      expect(issues.map((i) => i.id)).toContain("personas.placeholders");
      const md = await (await app.request(`/api/briefs/${brief.id}/brief.md`)).text();
      expect(md).toContain("# HubSpot sync");
      expect(md).toContain("**Target:** 40 demos a month");
    });

    it("rejects bad requests and reports failures", async () => {
      expect((await app.request(`/api/brands/${brand.id}/briefs?wait=true`, json({ prompt: " " }))).status).toBe(400);
      expect((await app.request(`/api/brands/${brand.id}/briefs?wait=true`, json({ prompt, seoProvider: "nope" }))).status).toBe(400);
      expect((await app.request("/api/briefs/nope")).status).toBe(404);

      const failing = createApp({
        store: new BrandStore(join(dir, "brands")),
        briefs: new BriefStore(join(dir, "briefs")),
        pages: new PageStore(join(dir, "pages")),
        submissions: new SubmissionStore(join(dir, "submissions")),
        outputDir: join(dir, "out"),
        generator: { name: "broken", generate: async () => { throw new GenerationError("The model declined to write this brief."); } },
      });
      const res = await failing.request(`/api/brands/${brand.id}/briefs?wait=true`, json({ prompt }));
      expect(res.status).toBe(502);
      expect((await res.json()).error).toMatch(/declined/);
    });

    it("falls back to best practices when the SEO tool is down", async () => {
      const down: SeoProvider = { id: "connected", name: "Semrush", description: "", research: async () => { throw new Error("timeout"); } };
      const withTool = createApp({
        store: new BrandStore(join(dir, "brands")),
        briefs: new BriefStore(join(dir, "briefs")),
        pages: new PageStore(join(dir, "pages")),
        submissions: new SubmissionStore(join(dir, "submissions")),
        outputDir: join(dir, "out"),
        generator: templateGenerator(),
        seoProviders: [down],
      });
      const res = await withTool.request(`/api/brands/${brand.id}/briefs?wait=true`, json({ prompt }));
      expect(res.status).toBe(201);
      expect((await res.json()).insights.notes[0]).toMatch(/Semrush couldn't be reached \(timeout\)/);
    });

    it("connects the site's MCP server and grounds briefs in it", async () => {
      expect((await app.request(`/api/brands/${brand.id}/site-mcp`, json({ url: `${site.url}nothing-here` }))).status).toBe(502);

      const res = await app.request(`/api/brands/${brand.id}/site-mcp`, json({ url: `${site.url}mcp` }));
      expect(res.status).toBe(200);
      const connected: Brand = await res.json();
      expect(connected.siteMcp).toMatchObject({ name: "Northloop", url: `${site.url}mcp` });
      expect(connected.siteMcp!.tools.filter((t) => t.use).map((t) => t.name)).toEqual(["list_plans", "search_help_center"]);

      site.mcpCalls.length = 0;
      const written: Brief = await (await app.request(`/api/brands/${brand.id}/briefs?wait=true`, json({ prompt }))).json();
      expect(site.mcpCalls.map((c) => c.name)).toEqual(["list_plans", "search_help_center"]);
      expect(site.mcpCalls[1]!.arguments).toEqual({ query: "HubSpot integration" });
      expect(written.siteData?.facts).toHaveLength(3);
      expect(written.proofPoints.filter((p) => p.source === "data")).toHaveLength(2);
      expect(await (await app.request(`/api/briefs/${written.id}/brief.md`)).text()).toContain("**Site data:** Northloop (3 answers)");

      const patched: Brand = await (await app.request(`/api/brands/${brand.id}/site-mcp`, { ...json({ allowed: ["latest_releases"] }), method: "PATCH" })).json();
      expect(patched.siteMcp!.tools.filter((t) => t.use).map((t) => t.name)).toEqual(["list_plans", "search_help_center", "latest_releases"]);

      const without: Brief = await (await app.request(`/api/brands/${brand.id}/briefs?wait=true`, json({ prompt, useSiteData: false }))).json();
      expect(without.siteData).toBeUndefined();

      const off: Brand = await (await app.request(`/api/brands/${brand.id}/site-mcp`, { method: "DELETE" })).json();
      expect(off.siteMcp).toBeUndefined();
    });
  });

  describe("pages", () => {
    let page: Page;
    let briefId: string;
    const received: { body: string; headers: IncomingMessage["headers"] }[] = [];
    const hook = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push({ body, headers: req.headers });
        res.writeHead(req.url === "/fail" ? 500 : 204).end();
      });
    });
    let hookUrl = "";
    beforeAll(async () => {
      await new Promise<void>((r) => hook.listen(0, "127.0.0.1", r));
      hookUrl = `http://127.0.0.1:${(hook.address() as { port: number }).port}`;
    });
    afterAll(() => new Promise<void>((r) => hook.close(() => r())));

    const put = (p: Page) => app.request(`/api/pages/${p.id}`, { ...json(p), method: "PUT" });
    const submit = (body: unknown, type = "application/json") =>
      app.request(`/api/forms/${page.id}`, { method: "POST", headers: { "content-type": type }, body: typeof body === "string" ? body : JSON.stringify(body) });

    it("builds a page from a brief, with a version per persona", async () => {
      const brief: Brief = await (await app.request(`/api/brands/${brand.id}/briefs?wait=true`, json({ prompt: "Landing page for our HubSpot integration for ops managers" }))).json();
      briefId = brief.id;
      const res = await app.request(`/api/briefs/${brief.id}/pages?wait=true`, { method: "POST" });
      expect(res.status).toBe(201);
      page = await res.json();
      expect(page).toMatchObject({ briefId: brief.id, brandId: brand.id, slug: brief.seo.slug, generator: { name: "template" } });
      expect(page.blocks[0]!.type).toBe("hero");
      expect(page.variants.map((v) => v.slug)).toEqual(brief.personas.map((p) => p.id));
      expect(await (await app.request(`/api/briefs/${brief.id}/pages`)).json()).toEqual([expect.objectContaining({ id: page.id, versions: page.variants.length })]);
    });

    it("won't build from a brief with must-fix issues", async () => {
      const brief: Brief = await (await app.request(`/api/briefs/${briefId}`)).json();
      const broken = await app.request(`/api/briefs/${briefId}`, { ...json({ ...brief, outline: brief.outline.filter((s) => s.type !== "hero") }), method: "PUT" });
      expect(broken.status).toBe(200);
      const res = await app.request(`/api/briefs/${briefId}/pages?wait=true`, { method: "POST" });
      expect(res.status).toBe(409);
      expect((await res.json()).issues[0].id).toBe("outline.hero-first");
      await app.request(`/api/briefs/${briefId}`, { ...json(brief), method: "PUT" });
    });

    it("saves edits, keeps ids, and drops overrides that point at nothing", async () => {
      const edited: Page = structuredClone(page);
      const hero = edited.blocks[0]!;
      if (hero.type !== "hero") throw new Error("no hero");
      hero.heading = "Sync HubSpot without engineers";
      edited.variants[0]!.overrides = { "hero.lead": "For you", "removed.heading": "x" };
      const res = await put({ ...edited, id: "other", briefId: "other" } as Page);
      expect(res.status).toBe(404);
      const saved: Page = await (await put(edited)).json();
      expect(saved).toMatchObject({ id: page.id, briefId });
      expect(saved.blocks[0]).toMatchObject({ heading: "Sync HubSpot without engineers" });
      expect(saved.variants[0]!.overrides).toEqual({ "hero.lead": "For you" });
      page = saved;

      const bad = await put({ ...saved, blocks: [{ ...saved.blocks[0]!, type: "carousel" }] } as unknown as Page);
      expect(bad.status).toBe(400);
    });

    it("checks the page and renders each version", async () => {
      const issues: PageIssue[] = await (await app.request(`/api/pages/${page.id}/check`)).json();
      expect(issues.map((i) => i.id)).toEqual(expect.arrayContaining(["leads.connector", "testimonial.placeholders"]));
      const general = await (await app.request(`/api/pages/${page.id}/page.html`)).text();
      expect(general).toContain("<h1 class=\"lph-h1\">Sync HubSpot without engineers</h1>");
      expect(general).toContain(`action="http://localhost/api/forms/${page.id}"`);
      expect(general).toContain("noindex");
      const v = page.variants[0]!;
      expect(await (await app.request(`/api/pages/${page.id}/page.html?version=${v.slug}`)).text()).toContain(">For you<");
      expect((await app.request(`/api/pages/${page.id}/page.html?version=nope`)).status).toBe(404);
    });

    it("keeps leads for testing when no connector is set, and explains bad fields", async () => {
      const bad = await submit({ fields: { email: "nope" } });
      expect(bad.status).toBe(422);
      expect((await bad.json()).errors).toMatchObject({ email: expect.stringMatching(/valid/), firstname: expect.stringMatching(/required/) });

      const ok = await submit({ fields: { email: "ada@example.com", firstname: "Ada" }, context: { variant: page.variants[0]!.slug, utm: { utm_source: "newsletter" } } });
      expect(ok.status).toBe(200);
      expect((await ok.json()).ok).toBe(true);
      // A plain form post works too.
      expect((await submit("email=grace%40example.com&firstname=Grace", "application/x-www-form-urlencoded")).status).toBe(200);
      // Bots are told it worked; nothing is kept.
      expect((await submit({ fields: { email: "bot@example.com", firstname: "Bot" }, _hp: "x" })).status).toBe(200);

      const list = await (await app.request(`/api/pages/${page.id}/submissions`)).json();
      expect(list.map((s: { values: { email: string } }) => s.values.email).sort()).toEqual(["ada@example.com", "grace@example.com"]);
      expect(list.find((s: { values: { email: string } }) => s.values.email === "ada@example.com")).toMatchObject({
        delivery: { status: "stored", connector: "none" },
        context: { variant: page.variants[0]!.slug, utm: { utm_source: "newsletter" } },
      });
    });

    it("sends leads to a signed webhook and reports a failing one", async () => {
      page = await (await put({ ...page, form: { ...page.form, connector: "webhook", webhookUrl: `${hookUrl}/lead` } })).json();
      const res = await submit({ fields: { email: "ada@example.com", firstname: "Ada" } });
      expect(res.status).toBe(200);
      const hit = received.at(-1)!;
      expect(JSON.parse(hit.body)).toMatchObject({ type: "lead", pageId: page.id, fields: { email: "ada@example.com", firstname: "Ada" } });
      expect(await verifyWebhook(hit.body, hit.headers["x-lph-signature"] as string, "test-secret")).toBe(true);

      page = await (await put({ ...page, form: { ...page.form, webhookUrl: `${hookUrl}/fail` } })).json();
      const failed = await submit({ fields: { email: "ada@example.com", firstname: "Ada" } });
      expect(failed.status).toBe(502);
      expect((await failed.json()).message).toMatch(/didn't go through/);
      const list = await (await app.request(`/api/pages/${page.id}/submissions`)).json();
      expect(list.some((s: { delivery: { status: string; detail?: string } }) => s.delivery.status === "failed" && s.delivery.detail === "The webhook answered 500.")).toBe(true);
    });

    it("refuses webhooks on private addresses when private URLs aren't allowed", async () => {
      const strict = createApp({
        store: new BrandStore(join(dir, "brands")),
        briefs: new BriefStore(join(dir, "briefs")),
        pages: new PageStore(join(dir, "pages")),
        submissions: new SubmissionStore(join(dir, "submissions")),
        generator: templateGenerator(),
        pageGenerator: templatePageGenerator(),
        outputDir: join(dir, "out"),
      });
      const before = received.length;
      const res = await strict.request(`/api/forms/${page.id}`, json({ fields: { email: "ada@example.com", firstname: "Ada" } }));
      expect(res.status).toBe(502);
      expect(received.length).toBe(before);
      expect((await strict.request("/api/forms/nope", json({}))).status).toBe(404);
    });
  });

  it("returns 404 for unknown brands and refuses path tricks", async () => {
    expect((await app.request("/api/brands/nope")).status).toBe(404);
    expect((await app.request("/api/brands/..%2F..%2Fetc")).status).toBe(404);
  });
});
