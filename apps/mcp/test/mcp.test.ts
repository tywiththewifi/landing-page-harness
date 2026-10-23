import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { templateGenerator } from "@lph/brief";
import { parseDocument, type GateRunner } from "@lph/checks";
import { templatePageGenerator } from "@lph/page";
import { createApp } from "../../api/src/app.ts";
import { BrandStore, BriefStore, GateStore, PageStore, SubmissionStore } from "../../api/src/store.ts";
import { serveFixture } from "../../../scripts/serve-fixture.mjs";
import { ApiClient } from "../src/client.ts";
import { reportMarkdown, runFromUrl } from "../src/pipeline.ts";
import { createServer } from "../src/server.ts";

describe("MCP server", () => {
  let site: Awaited<ReturnType<typeof serveFixture>>;
  let dir: string;
  let api: ApiClient;
  let client: Client;

  beforeAll(async () => {
    site = await serveFixture();
    dir = await mkdtemp(join(tmpdir(), "lph-mcp-"));
    // The gate's browser checks are covered in @lph/checks; here they parse the HTML only.
    const runner: GateRunner = { environment: "server", parse: parseDocument };
    const app = createApp({
      store: new BrandStore(join(dir, "brands")),
      briefs: new BriefStore(join(dir, "briefs")),
      pages: new PageStore(join(dir, "pages")),
      submissions: new SubmissionStore(join(dir, "submissions")),
      gates: new GateStore(join(dir, "gates")),
      generator: templateGenerator(),
      pageGenerator: templatePageGenerator(),
      outputDir: join(dir, "out"),
      allowPrivateUrls: true,
      gateRunner: async () => runner,
    });
    api = new ApiClient("http://lph.test", (r) => app.fetch(r));
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createServer(api).connect(serverSide);
    client = new Client({ name: "test", version: "0" });
    await client.connect(clientSide);
  });
  afterAll(async () => {
    await client.close();
    await site.close();
    await rm(dir, { recursive: true, force: true });
  });

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[]; isError?: boolean };
    return { ...res, text: res.content.map((c) => c.text).join("\n") };
  };

  it("lists the tools with instructions", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["launch_from_url", "import_brand", "get_brand", "write_brief", "update_brief", "build_page", "update_page", "run_checks", "publish_plan", "publish_page"]),
    );
    expect(client.getInstructions()).toMatch(/launch_from_url/);
  });

  it("runs a URL through every step and reports where it got to", async () => {
    const res = await call("launch_from_url", { url: site.url, prompt: "Landing page for our HubSpot integration for ops managers" });
    expect(res.isError).toBeFalsy();
    expect(res.text).toMatch(/^# Northloop/);
    expect(res.text).toMatch(/## Publish gate/);
    // The offline writer leaves copy for a person, so the checks block.
    expect(res.text).toMatch(/Verdict: \*\*blocked\*\*/);
    const ids = JSON.parse(res.content[1]!.text);
    expect(ids).toMatchObject({ brandId: expect.any(String), briefId: expect.any(String), pageId: expect.any(String) });

    const design = await call("get_brand", { brandId: ids.brandId, format: "design.md" });
    expect(design.text).toMatch(/Northloop/);
    const html = await call("get_page", { pageId: ids.pageId, format: "html" });
    expect(html.text).toMatch(/<h1/);
    const plan = JSON.parse((await call("publish_plan", { pageId: ids.pageId })).text);
    expect(plan.target).toBeNull();
  });

  it("edits a brief and returns the new check", async () => {
    const brand = JSON.parse((await call("import_brand", { url: site.url })).text);
    expect(brand.links.preview).toBe(`http://lph.test/api/brands/${brand.id}/preview.html`);
    const brief = JSON.parse((await call("write_brief", { brandId: brand.id, prompt: "Landing page for our HubSpot integration for ops managers" })).text);
    const full = JSON.parse((await call("get_brief", { briefId: brief.id, format: "json" })).text);
    const edited = JSON.parse((await call("update_brief", { briefId: brief.id, changes: { offer: { ...full.offer, primaryCta: "Book a demo" } } })).text);
    expect(edited.cta).toBe("Book a demo");
    expect(edited.check.issues.join("\n")).not.toMatch(/long for a button/);
  });

  it("reads brands as resources", async () => {
    const { resources } = await client.listResources();
    const design = resources.find((r) => r.uri.endsWith("/design.md"))!;
    const read = await client.readResource({ uri: design.uri });
    expect(read.contents[0]).toMatchObject({ mimeType: "text/markdown" });
  });

  it("turns API errors into tool errors", async () => {
    const res = await call("get_brand", { brandId: "nope" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/Brand not found/);
    const refused = await call("launch_from_url", { url: "not a url" });
    expect(refused.isError).toBe(true);
  });

  it("stops at the first failing step and says why", async () => {
    const report = await runFromUrl(api, { url: "http://127.0.0.1:1/" });
    expect(report.reached).toBeNull();
    expect(report.stopped?.stage).toBe("import");
    expect(reportMarkdown(report)).toMatch(/## Stopped/);
  });
});
