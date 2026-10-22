import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Brand } from "@lph/tokens";
import { serveFixture } from "../../../scripts/serve-fixture.mjs";
import { createApp } from "../src/app.ts";
import { BrandStore } from "../src/store.ts";
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
  let site: { url: string; close: () => Promise<void> };
  let dir: string;
  let app: ReturnType<typeof createApp>;
  let brand: Brand;

  beforeAll(async () => {
    site = await serveFixture();
    dir = await mkdtemp(join(tmpdir(), "lph-api-"));
    app = createApp({ store: new BrandStore(join(dir, "data")), outputDir: join(dir, "out"), allowPrivateUrls: true });
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

  it("returns 404 for unknown brands and refuses path tricks", async () => {
    expect((await app.request("/api/brands/nope")).status).toBe(404);
    expect((await app.request("/api/brands/..%2F..%2Fetc")).status).toBe(404);
  });
});
