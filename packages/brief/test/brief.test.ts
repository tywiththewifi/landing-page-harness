import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { Brand } from "@lph/tokens";
import {
  GenerationError,
  bestPractices,
  briefContent,
  briefToMarkdown,
  checkBrief,
  claudeGenerator,
  httpProvider,
  numberIsSourced,
  numbersIn,
  parsePrompt,
  siteCasing,
  templateGenerator,
  toBrief,
  type Brief,
  type BriefContent,
} from "../src/index.ts";

/** A brand as the extractor returns it for the Northloop fixture, trimmed to what briefs use. */
const brand = {
  id: "northloop",
  name: "Northloop",
  url: "https://northloop.test/",
  summary: "Northloop uses forest green with a lime accent, Archivo headings and Plus Jakarta Sans body text.",
  content: [
    {
      url: "https://northloop.test/",
      title: "Northloop | Workflow automation for ops teams",
      description: "Northloop connects your CRM, billing and support tools so ops teams ship workflows in days, not quarters.",
      lang: "en",
      headings: [
        { level: 1, text: "Automate the work between your tools" },
        { level: 2, text: "Built for teams without an automation engineer" },
        { level: 2, text: "Trusted by 400 ops teams" },
        { level: 4, text: "99.95% uptime" },
        { level: 4, text: "300+ connectors" },
        { level: 2, text: "Talk to us" },
      ],
      paragraphs: [
        "Northloop connects your CRM, billing and support tools so ops teams ship workflows in days, not quarters.",
        "Templates for the workflows every revenue team rebuilds from scratch.",
        "Send every new lead to the right owner in seconds, with enrichment on the way.",
      ],
      ctas: ["Book a demo", "Start free"],
    },
  ],
} as unknown as Brand;

const insights = { provider: "best-practices", keywords: [], questions: [], notes: [] };
const meta = (content: BriefContent, generator = templateGenerator()): Brief =>
  toBrief(content, { id: "b1", brandId: brand.id, prompt: "Landing page for our new HubSpot integration for ops managers", generator, insights });

describe("grounding helpers", () => {
  it("finds the numbers worth sourcing", () => {
    expect(numbersIn("99.95% uptime, 300+ connectors, $49 a month, 2x faster")).toEqual(["99.95%", "300+", "$49", "2x"]);
    expect(numbersIn("Three steps, 3 clicks")).toEqual([]);
    expect(numbersIn("Trusted by 400 ops teams")).toEqual(["400"]);
  });

  it("matches numbers whatever their formatting", () => {
    expect(numberIsSourced("300", ["300+ connectors"])).toBe(true);
    expect(numberIsSourced("73%", ["300+ connectors"])).toBe(false);
  });

  it("reads the site's heading casing", () => {
    expect(siteCasing(brand)).toBe("sentence");
  });

  it("splits a request into topic and audience", () => {
    expect(parsePrompt("Landing page for our new HubSpot integration for ops managers")).toEqual({ topic: "HubSpot integration", audience: "ops managers" });
    expect(parsePrompt("Create a campaign page about the spring pricing change")).toEqual({ topic: "spring pricing change", audience: null });
  });
});

describe("template generator", () => {
  it("writes a schema-valid brief grounded in the site", async () => {
    const content = await templateGenerator().generate({ prompt: "Landing page for our new HubSpot integration for ops managers", brand, insights });
    expect(briefContent.safeParse(content).success).toBe(true);
    expect(content.funnelStage).toBe("consideration");
    expect(content.outline[0]!.type).toBe("hero");
    expect(content.outline.map((s) => s.type)).toContain("form");
    expect(content.offer.primaryCta).toBe("Book a demo");
    expect(content.personas[0]!.name).toBe("Ops managers");
    expect(content.proofPoints.filter((p) => p.source === "site").map((p) => p.claim)).toContain("Trusted by 400 ops teams");
    expect(content.proofPoints.some((p) => p.source === "needed")).toBe(true);
    expect(content.seo.slug).toBe("hubspot-integration");
  });

  it("picks the funnel stage from the request", async () => {
    const gen = templateGenerator();
    expect((await gen.generate({ prompt: "Northloop vs Zapier comparison page", brand, insights })).funnelStage).toBe("decision");
    expect((await gen.generate({ prompt: "Announce our launch in Europe", brand, insights })).funnelStage).toBe("awareness");
  });
});

describe("consistency check", () => {
  it("passes a template brief with only warnings for what a person must fill in", async () => {
    const brief = meta(await templateGenerator().generate({ prompt: "Landing page for our new HubSpot integration for ops managers", brand, insights }));
    const issues = checkBrief(brief, brand);
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    const ids = issues.map((i) => i.id);
    expect(ids).toContain("objective.kpi-target");
    expect(ids).toEqual(expect.arrayContaining(["personas.placeholders", "seo.placeholders"]));
    expect(ids.some((id) => id.startsWith("proof.needed"))).toBe(true);
    // Site numbers are sourced, so none are flagged.
    expect(ids.some((id) => id.includes("number"))).toBe(false);
  });

  it("flags invented numbers, structural mistakes and SEO problems", async () => {
    const brief = meta(await templateGenerator().generate({ prompt: "Landing page for our new HubSpot integration for ops managers", brand, insights }));
    brief.keyMessages.push({ message: "Cut busywork by 73%", support: "Used by 400 ops teams." });
    brief.outline = brief.outline.filter((s) => s.type !== "hero" && s.type !== "faq" && s.type !== "form");
    brief.seo.slug = "HubSpot Integration";
    brief.offer.primaryCta = "Book a personalised demo with our team today";
    const issues = checkBrief(brief, brand);
    const ids = issues.map((i) => i.id);
    expect(issues.find((i) => i.id === "messages.number-1")?.message).toContain("73%");
    expect(issues.filter((i) => i.id.includes("number"))).toHaveLength(1);
    expect(ids).toEqual(expect.arrayContaining(["outline.hero-first", "outline.form", "seo.slug", "seo.faq-schema", "offer.cta-length", "offer.cta-new"]));
  });

  it("checks that evidence is really on the site", async () => {
    const brief = meta(await templateGenerator().generate({ prompt: "Landing page for our new HubSpot integration", brand, insights }));
    brief.proofPoints = [{ claim: "Loved by ops teams", source: "site", evidence: "Rated 4.9 on G2 by 1,000 reviewers" }];
    expect(checkBrief(brief, brand).map((i) => i.id)).toContain("proof.site-1");
  });
});

describe("SEO providers", () => {
  it("falls back to best practices with no data", async () => {
    expect(await bestPractices.research({ topic: "x", siteUrl: brand.url, lang: "en" })).toMatchObject({ provider: "best-practices", keywords: [] });
  });

  it("connects any tool through one HTTP endpoint and keeps only usable data", async () => {
    let sent: { url: string; body: string; auth: string | null } | null = null;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      sent = { url, body: String(init.body), auth: new Headers(init.headers).get("authorization") };
      return Response.json({ keywords: [{ term: "hubspot workflow automation", volume: 880, difficulty: 31 }, "hubspot ops", { volume: 5 }], questions: ["Does it sync deals?", 4] });
    }) as unknown as typeof fetch;
    const provider = httpProvider({ name: "Semrush via n8n", url: "https://hooks.test/seo", token: "t0k", fetch: fakeFetch });
    const result = await provider.research({ topic: "HubSpot integration", siteUrl: brand.url, lang: "en" });
    expect(sent!.auth).toBe("Bearer t0k");
    expect(JSON.parse(sent!.body)).toMatchObject({ topic: "HubSpot integration" });
    expect(result.keywords).toEqual([
      { term: "hubspot workflow automation", volume: 880, difficulty: 31, intent: null },
      { term: "hubspot ops", volume: null, difficulty: null, intent: null },
    ]);
    expect(result.questions).toEqual(["Does it sync deals?"]);
  });

  it("reports a failing endpoint", async () => {
    const provider = httpProvider({ name: "Tool", url: "https://hooks.test/seo", fetch: (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch });
    await expect(provider.research({ topic: "x", siteUrl: brand.url, lang: "en" })).rejects.toThrow(/500/);
  });
});

describe("Claude generator", () => {
  const fakeClient = (reply: object) => {
    const calls: Record<string, unknown>[] = [];
    const client = { beta: { messages: { parse: async (params: Record<string, unknown>) => (calls.push(params), reply) } } } as unknown as Anthropic;
    return { client, calls };
  };

  it("sends the site copy as data and returns the parsed brief", async () => {
    const content = await templateGenerator().generate({ prompt: "HubSpot integration page", brand, insights });
    const { client, calls } = fakeClient({ stop_reason: "end_turn", parsed_output: content });
    const gen = claudeGenerator({ client });
    expect(await gen.generate({ prompt: "HubSpot integration page", brand, insights })).toBe(content);
    const params = calls[0]!;
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.fallbacks).toBe("default");
    expect((params.output_config as { format: unknown }).format).toBeTruthy();
    const user = (params.messages as { content: string }[])[0]!.content;
    expect(user).toContain("<site_copy>");
    expect(user).toContain("Trusted by 400 ops teams");
    expect(user).toContain("<request>\nHubSpot integration page\n</request>");
    expect(JSON.stringify(params.system)).toContain("Never invent numbers");
  });

  it("turns a refusal into a readable error", async () => {
    const { client } = fakeClient({ stop_reason: "refusal", parsed_output: null });
    await expect(claudeGenerator({ client }).generate({ prompt: "x", brand, insights })).rejects.toBeInstanceOf(GenerationError);
  });
});

describe("stored brief", () => {
  it("gives each persona a unique id and exports Markdown", async () => {
    const content = await templateGenerator().generate({ prompt: "Landing page for our new HubSpot integration for ops managers", brand, insights });
    content.personas.push({ ...content.personas[0]! });
    const brief = meta(content);
    expect(brief.personas.map((p) => p.id)).toEqual(["ops-managers", "ops-managers-2"]);
    const md = briefToMarkdown(brief);
    for (const heading of ["## Objective", "## Personas", "## Key messages", "## Page outline", "## SEO and AEO", "### Questions to answer"]) expect(md).toContain(heading);
  });
});
