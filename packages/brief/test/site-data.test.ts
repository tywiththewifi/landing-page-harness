import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Brand } from "@lph/tokens";
import { serveFixture } from "../../../scripts/serve-fixture.mjs";
import { briefContext, checkBrief, collectSiteData, inspectMcp, templateGenerator, toBrief, toolUse } from "../src/index.ts";

describe("site MCP", () => {
  let site: Awaited<ReturnType<typeof serveFixture>>;
  beforeAll(async () => {
    site = await serveFixture();
  });
  afterAll(() => site.close());

  it("decides which tools are safe to call", () => {
    const text = { type: "string" };
    expect(toolUse({ name: "a", annotations: { readOnlyHint: true } }).use).toBe("auto");
    expect(toolUse({ name: "b", annotations: { readOnlyHint: true }, inputSchema: { properties: { q: text } } })).toMatchObject({ use: "query", arg: "q" });
    expect(toolUse({ name: "c", annotations: { readOnlyHint: true }, inputSchema: { properties: { search: text }, required: ["search"] } })).toMatchObject({ use: "query", arg: "search" });
    // A required input that isn't a search can't be filled with the topic.
    expect(toolUse({ name: "c2", annotations: { readOnlyHint: true }, inputSchema: { properties: { page: text }, required: ["page"] } }).use).toBeNull();
    expect(toolUse({ name: "d", annotations: { readOnlyHint: true }, inputSchema: { properties: { a: text, b: text }, required: ["a", "b"] } }).use).toBeNull();
    // No annotation is not the same as read-only.
    expect(toolUse({ name: "e" }).use).toBeNull();
    expect(toolUse({ name: "f", annotations: { readOnlyHint: false } }).use).toBeNull();
  });

  it("lists what the server offers and what will be used", async () => {
    const server = await inspectMcp(`${site.url}mcp`);
    expect(server.name).toBe("Northloop");
    expect(server.tools.map((t) => [t.name, t.use])).toEqual([
      ["list_plans", "auto"],
      ["search_help_center", "query"],
      ["latest_releases", null],
      ["get_customer_story", null],
      ["book_demo", null],
    ]);
    expect(server.resources).toEqual([{ uri: "northloop://integrations", name: "Integrations" }]);
  });

  it("collects answers from read-only tools and never calls the others", async () => {
    site.mcpCalls.length = 0;
    const data = await collectSiteData(`${site.url}mcp`, "HubSpot integration");
    expect(site.mcpCalls).toEqual([
      { name: "list_plans", arguments: {} },
      { name: "search_help_center", arguments: { query: "HubSpot integration" } },
    ]);
    expect(data.server).toEqual({ name: "Northloop", url: `${site.url}mcp` });
    expect(data.facts.map((f) => f.source)).toEqual(["tool:list_plans", "tool:search_help_center", "resource:northloop://integrations"]);
    expect(data.facts[1]!.text).toContain("every 5 minutes");
    expect(data.notes.join(" ")).toMatch(/3 tools were skipped/);
  });

  it("calls a tool that isn't marked read-only only when a person allows it", async () => {
    const server = await inspectMcp(`${site.url}mcp`, { allowed: ["latest_releases", "book_demo", "nope"] });
    expect(server.allowed).toEqual(["latest_releases", "book_demo"]);
    expect(server.tools.find((t) => t.name === "latest_releases")).toMatchObject({ readOnly: false, use: "auto" });
    // Allowing doesn't help a tool whose inputs Softlander can't fill.
    expect(server.tools.find((t) => t.name === "book_demo")?.use).toBeNull();

    site.mcpCalls.length = 0;
    await collectSiteData(`${site.url}mcp`, "HubSpot integration", { allowed: ["latest_releases"] });
    expect(site.mcpCalls.map((c) => c.name)).toEqual(["list_plans", "search_help_center", "latest_releases"]);
  });

  it("grounds the brief in site data", async () => {
    const siteData = await collectSiteData(`${site.url}mcp`, "HubSpot integration");
    const brand = { id: "n", name: "Northloop", url: site.url, summary: "", content: [] } as unknown as Brand;
    const insights = { provider: "best-practices", keywords: [], questions: [], notes: [] };
    const prompt = "Landing page for our new HubSpot integration for ops managers";

    const context = briefContext({ brand, insights, siteData });
    expect(context).toContain('<site_data server="Northloop">');
    expect(context).toContain("$199 a month");

    const generator = templateGenerator();
    const content = await generator.generate({ prompt, brand, insights, siteData });
    const data = content.proofPoints.filter((p) => p.source === "data");
    expect(data.map((p) => p.claim)).toContain("Connect HubSpot: The HubSpot integration syncs contacts, companies and deals both ways every 5 minutes.");

    const brief = toBrief(content, { id: "b", brandId: "n", prompt, generator, insights, siteData });
    // Numbers from the site data are sourced; evidence that isn't there is flagged.
    brief.keyMessages.push({ message: "Two-way sync every 5 minutes, from $199 a month", support: "" });
    brief.proofPoints.push({ claim: "Syncs in real time", source: "data", evidence: "Syncs every second" });
    const ids = checkBrief(brief, brand).map((i) => i.id);
    expect(ids.some((id) => id.includes("number"))).toBe(false);
    expect(ids).toContain(`proof.data-${brief.proofPoints.length}`);
  });

  it("fails clearly when nothing answers", async () => {
    await expect(inspectMcp("http://127.0.0.1:9/mcp", { timeoutMs: 2000 })).rejects.toThrow();
  });
});
