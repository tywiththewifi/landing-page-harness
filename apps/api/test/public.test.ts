import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Brand } from "@lph/tokens";
import { serveFixture } from "../../../scripts/serve-fixture.mjs";
import { createPublicApp } from "../src/public.ts";

const json = (body: unknown, ip = "1.1.1.1") => ({ method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `${ip}, 10.0.0.1` }, body: JSON.stringify(body) });
const fakeBrand = (url: string) => ({ id: `b-${new URL(url).host.replace(/\W/g, "-")}`, name: "Site", url }) as unknown as Brand;

async function finish(app: ReturnType<typeof createPublicApp>, id: string) {
  for (let i = 0; i < 100; i++) {
    const job = await (await app.request(`/api/jobs/${id}`)).json();
    if (job.status !== "running") return job;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("job never finished");
}

describe("public import service", () => {
  let site: Awaited<ReturnType<typeof serveFixture>>;
  beforeAll(async () => {
    site = await serveFixture();
  });
  afterAll(() => site.close());

  it("imports, hands the brand back once and forgets it", async () => {
    const app = createPublicApp({ extract: async ({ url }) => fakeBrand(url), allowPrivateUrls: true });
    const res = await app.request("/api/brands", json({ url: site.url, id: "keep-me" }));
    expect(res.status).toBe(202);
    const job = await finish(app, (await res.json()).id);
    expect(job).toMatchObject({ status: "done", brandId: "keep-me", brand: { id: "keep-me", url: site.url } });
    expect((await app.request(`/api/jobs/${job.id}`)).status).toBe(404);
  });

  it("refuses private addresses unless allowed", async () => {
    const app = createPublicApp({ extract: async ({ url }) => fakeBrand(url) });
    const res = await app.request("/api/brands", json({ url: "http://169.254.169.254/latest/meta-data" }));
    expect(res.status).toBe(400);
    expect((await app.request("/api/site-mcp/inspect", json({ url: `${site.url}mcp` }))).status).toBe(400);
  });

  it("limits imports per visitor and queues beyond the browser limit", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const app = createPublicApp({ extract: async ({ url }) => (await gate, fakeBrand(url)), allowPrivateUrls: true, importsPerHour: 2, maxConcurrent: 1 });
    const first = await (await app.request("/api/brands", json({ url: site.url }))).json();
    const second = await (await app.request("/api/brands", json({ url: site.url }))).json();
    expect(second.step).toMatch(/Waiting for a free browser/);
    const third = await app.request("/api/brands", json({ url: site.url }));
    expect(third.status).toBe(429);
    expect((await third.json()).error).toMatch(/2 imports an hour/);
    // Another visitor isn't affected.
    expect((await app.request("/api/brands", json({ url: site.url }, "2.2.2.2"))).status).toBe(202);
    release();
    expect((await finish(app, first.id)).status).toBe("done");
    expect((await finish(app, second.id)).status).toBe("done");
  });

  it("caps imports for everyone together", async () => {
    const app = createPublicApp({ extract: async ({ url }) => fakeBrand(url), allowPrivateUrls: true, importsPerHour: 5, importsPerHourTotal: 2 });
    expect((await app.request("/api/brands", json({ url: site.url }, "1.1.1.1"))).status).toBe(202);
    expect((await app.request("/api/brands", json({ url: site.url }, "2.2.2.2"))).status).toBe(202);
    const third = await app.request("/api/brands", json({ url: site.url }, "3.3.3.3"));
    expect(third.status).toBe(429);
    expect((await third.json()).error).toMatch(/all the imports it can this hour/);
  });

  it("holds the page's own requests to the same rule", async () => {
    let allowAddress: ((ip: string) => boolean) | undefined;
    const app = createPublicApp({ extract: async (o) => ((allowAddress = o.allowAddress), fakeBrand(o.url)), allowPrivateUrls: false });
    await finish(app, (await (await app.request("/api/brands", json({ url: "http://93.184.215.14/" }))).json()).id);
    expect(allowAddress?.("93.184.215.14")).toBe(true);
    expect(allowAddress?.("10.0.0.1")).toBe(false);
    expect(allowAddress?.("::ffff:127.0.0.1")).toBe(false);
  });

  it("reports a failed import", async () => {
    const app = createPublicApp({ extract: async () => { throw new Error("net::ERR_NAME_NOT_RESOLVED"); }, allowPrivateUrls: true });
    const job = await finish(app, (await (await app.request("/api/brands", json({ url: site.url }))).json()).id);
    expect(job).toMatchObject({ status: "failed", error: "net::ERR_NAME_NOT_RESOLVED" });
  });

  it("inspects and reads a site's MCP server", async () => {
    const app = createPublicApp({ extract: async ({ url }) => fakeBrand(url), allowPrivateUrls: true });
    const server = await (await app.request("/api/site-mcp/inspect", json({ url: `${site.url}mcp` }))).json();
    expect(server.tools.filter((t: { use: string | null }) => t.use).map((t: { name: string }) => t.name)).toEqual(["list_plans", "search_help_center"]);
    site.mcpCalls.length = 0;
    const data = await (await app.request("/api/site-mcp/collect", json({ url: `${site.url}mcp`, topic: "HubSpot integration" }))).json();
    expect(data.facts).toHaveLength(3);
    expect(site.mcpCalls.map((c) => c.name)).toEqual(["list_plans", "search_help_center"]);
    expect((await app.request("/api/site-mcp/inspect", json({ url: `${site.url}nope` }))).status).toBe(502);
  });
});
