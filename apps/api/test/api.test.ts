import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenerationError, templateGenerator, type Brief, type BriefIssue, type SeoProvider } from "@lph/brief";
import type { Brand } from "@lph/tokens";
import { serveFixture } from "../../../scripts/serve-fixture.mjs";
import { createApp } from "../src/app.ts";
import { BrandStore, BriefStore } from "../src/store.ts";
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
      generator: templateGenerator(),
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
      expect(await (await app.request("/api/generator")).json()).toEqual({ name: "template", model: null });
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

  it("returns 404 for unknown brands and refuses path tricks", async () => {
    expect((await app.request("/api/brands/nope")).status).toBe(404);
    expect((await app.request("/api/brands/..%2F..%2Fetc")).status).toBe(404);
  });
});
