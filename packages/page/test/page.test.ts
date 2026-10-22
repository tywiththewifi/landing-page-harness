import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { GenerationError, PLACEHOLDER, bestPractices, templateGenerator, toBrief, type Brief } from "@lph/brief";
import type { Brand } from "@lph/tokens";
import northloop from "../../../apps/studio/src/demo/northloop.json";
import {
  applyCopy,
  applyVariant,
  buttonsFor,
  checkPage,
  claudePageGenerator,
  emptyBlock,
  keyLabel,
  pageEdit,
  pruneOverrides,
  renderPage,
  safeHref,
  templatePageGenerator,
  textPaths,
  toPage,
  valueIn,
  type Page,
  type PageCopy,
} from "../src/index.ts";

const brand = northloop as unknown as Brand;
const css = ".lph{}";
const prompt = "A landing page for our new HubSpot integration aimed at RevOps leads at SaaS companies";

async function makeBrief(): Promise<Brief> {
  const insights = await bestPractices.research({ topic: prompt, siteUrl: brand.url, lang: "en" });
  const gen = templateGenerator();
  const brief = toBrief(await gen.generate({ prompt, brand, insights }), { id: "brief-1", brandId: brand.id, prompt, generator: gen, insights });
  // Fill the persona in, as a marketer would before building the page.
  brief.personas[0] = {
    ...brief.personas[0]!,
    motivations: ["Stop rebuilding the same workflows every quarter"],
    pains: ["Leads sit unrouted while the team waits on engineering"],
  };
  return brief;
}

async function makePage(brief?: Brief): Promise<{ page: Page; brief: Brief }> {
  brief ??= await makeBrief();
  const gen = templatePageGenerator();
  return { page: toPage(await gen.generate({ brief, brand }), { id: "page-1", brief, generator: gen, now: new Date("2026-10-22T08:00:00Z") }), brief };
}

/** A page with every placeholder written, so the checks that remain are the interesting ones. */
async function finishedPage() {
  const { page, brief } = await makePage();
  const fill = (v: unknown): unknown =>
    typeof v === "string" ? (v.includes(PLACEHOLDER) ? "Written by a person" : v) : Array.isArray(v) ? v.map(fill) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)])) : v;
  page.blocks = fill(page.blocks) as Page["blocks"];
  page.form = { connector: "hubspot", webhookUrl: "", hubspotPortalId: "123456", hubspotFormId: "0e295a5b-85c8-4061-a36f-eb1f0749b877" };
  return { page, brief };
}

describe("template page generator", () => {
  it("builds every outline section as a block, hero first, with anchors buttons can use", async () => {
    const { page, brief } = await makePage();
    expect(page.blocks.map((b) => b.type)).toEqual(brief.outline.map((s) => s.type));
    expect(page.blocks[0]!.type).toBe("hero");
    expect(new Set(page.blocks.map((b) => b.id)).size).toBe(page.blocks.length);
    const hero = page.blocks[0]!;
    if (hero.type !== "hero") throw new Error("no hero");
    expect(hero.heading).toBe(brief.outline[0]!.heading);
    expect(hero.primaryCta).toEqual({ label: brief.offer.primaryCta, href: "#form" });
    expect(page.slug).toBe(brief.seo.slug);
    expect(page.form.connector).toBe("none");
  });

  it("only uses proof the brief sourced, and marks the rest for a person", async () => {
    const { page } = await makePage();
    const testimonial = page.blocks.find((b) => b.type === "testimonial");
    expect(testimonial && "quote" in testimonial && testimonial.quote).toContain(PLACEHOLDER);
    const faq = page.blocks.find((b) => b.type === "faq");
    expect(faq?.type === "faq" && faq.items.length).toBeGreaterThanOrEqual(3);
  });

  it("writes a version per persona that leads with what they care about", async () => {
    const { page, brief } = await makePage();
    expect(page.variants).toHaveLength(brief.personas.length);
    const v = page.variants[0]!;
    expect(v.slug).toBe(brief.personas[0]!.id);
    // "RevOps" keeps its capitals after "For".
    expect(v.overrides["hero.eyebrow"]).toBe("For RevOps leads at SaaS companies");
    expect(v.overrides["hero.heading"]).toBeTruthy();
    expect(brief.keyMessages.map((m) => m.message)).toContain(v.overrides["hero.heading"]);
  });
});

describe("versions", () => {
  it("override copy only, and fall back to the general page", async () => {
    const { page } = await makePage();
    const v = { ...page.variants[0]!, overrides: { "hero.heading": "For you", "hero.primaryCta.href": "https://evil.example", "hero.tone": "brand", "seo.title": "Personal title" } };
    const view = applyVariant(page, v);
    const hero = view.blocks[0]!;
    expect(hero.type === "hero" && hero.heading).toBe("For you");
    expect(hero.type === "hero" && hero.primaryCta.href).toBe("#form");
    expect(hero.tone).toBe("default");
    expect(view.seo.title).toBe("Personal title");
    expect(page.blocks[0]!.type === "hero" && page.blocks[0]!.heading).not.toBe("For you");
    expect(valueIn(page, v, "hero.lead")).toBe(page.blocks[0]!.type === "hero" && page.blocks[0]!.lead);
  });

  it("drop overrides that point at removed blocks or repeat the general page", async () => {
    const { page } = await makePage();
    const hero = page.blocks[0]!;
    page.variants[0]!.overrides = { "hero.heading": hero.type === "hero" ? hero.heading : "", "gone.heading": "x", "hero.lead": "Mine" };
    expect(pruneOverrides(page).variants[0]!.overrides).toEqual({ "hero.lead": "Mine" });
  });

  it("name the text they personalise in plain words", async () => {
    const { page } = await makePage();
    expect(keyLabel(page, "hero.heading")).toBe("H1");
    expect(keyLabel(page, "hero.lead")).toBe("Subheadline");
    expect(keyLabel(page, "features.items.1.title")).toBe("Features item 2 title");
    expect(keyLabel(page, "seo.metaDescription")).toBe("Meta description");
    expect(textPaths(emptyBlock("form", "form"))).not.toContain("form.fields.0.name");
  });
});

describe("checkPage", () => {
  it("blocks publishing while placeholders are left", async () => {
    const { page, brief } = await makePage();
    const issues = checkPage(page, brief, brand);
    expect(issues.filter((i) => i.severity === "error").map((i) => i.id)).toEqual(expect.arrayContaining(["testimonial.placeholders", "steps.placeholders"]));
  });

  it("passes a finished page with nothing to fix", async () => {
    const { page, brief } = await finishedPage();
    const issues = checkPage(page, brief, brand);
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("catches structure, link and form mistakes", async () => {
    const { page, brief } = await finishedPage();
    const hero = page.blocks[0]!;
    if (hero.type !== "hero") throw new Error("no hero");
    hero.primaryCta.href = "#pricing";
    hero.secondaryCta = { label: "Watch the video", href: "javascript:alert(1)" };
    page.blocks = [...page.blocks.slice(1), hero];
    const form = page.blocks.find((b) => b.type === "form");
    if (form?.type === "form") form.fields = form.fields.filter((f) => f.name !== "email");
    page.form.hubspotFormId = "nope";
    const ids = checkPage(page, brief, brand).filter((i) => i.severity === "error").map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(["logos.hero-first", "hero.primaryCta-href", "hero.secondaryCta-href", "form.contact", "form.hubspot-form"]));
  });

  it("flags numbers and quotes nobody sourced", async () => {
    const { page, brief } = await finishedPage();
    const testimonial = page.blocks.find((b) => b.type === "testimonial");
    if (testimonial?.type === "testimonial") testimonial.quote = "Northloop saved us 37 hours a week.";
    page.variants[0]!.overrides["hero.lead"] = "Teams cut routing time by 64%.";
    const issues = checkPage(page, brief, brand);
    expect(issues.find((i) => i.message.includes('"37"'))?.severity).toBe("warning");
    expect(issues.find((i) => i.id === "testimonial.quote-source")?.severity).toBe("warning");
    const variantNumber = issues.find((i) => i.message.includes('"64%"'));
    expect(variantNumber).toMatchObject({ variant: page.variants[0]!.id, path: "hero.lead" });
    // A number the site states is fine.
    page.variants[0]!.overrides["hero.lead"] = "Trusted by 400 ops teams.";
    expect(checkPage(page, brief, brand).some((i) => i.message.includes('"400"'))).toBe(false);
  });

  it("checks each version's URL and that it says something different", async () => {
    const { page, brief } = await finishedPage();
    page.variants.push({ ...page.variants[0]!, id: "copy", overrides: {} });
    page.variants.push({ id: "bad", personaId: "x", name: "Bad", slug: "Not A Slug", overrides: { "hero.eyebrow": "x" } });
    const issues = checkPage(page, brief, brand);
    expect(issues.find((i) => i.id === "copy:versions.slug-taken")?.severity).toBe("error");
    expect(issues.find((i) => i.id === "copy:versions.same")?.severity).toBe("warning");
    expect(issues.find((i) => i.id === "bad:versions.slug")?.severity).toBe("error");
  });

  it("asks where leads go", async () => {
    const { page, brief } = await finishedPage();
    page.form.connector = "none";
    expect(checkPage(page, brief, brand).find((i) => i.id === "form.connector")?.severity).toBe("warning");
    page.form = { connector: "webhook", webhookUrl: "http://hooks.example", hubspotPortalId: "", hubspotFormId: "" };
    expect(checkPage(page, brief, brand).find((i) => i.id === "form.webhook")?.severity).toBe("error");
  });
});

describe("renderPage", () => {
  it("renders one H1, SEO tags and structured data for the general page", async () => {
    const { page, brief } = await finishedPage();
    const html = renderPage(page, brand, css, { origin: "https://northloop.example" });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toContain(`<title>${page.seo.title.replace(/&/g, "&amp;")}</title>`);
    expect(html).toContain(`<link rel="canonical" href="https://northloop.example/${page.slug}"/>`);
    expect(html).toContain('<html lang="en">');
    expect(html).not.toContain("noindex");
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]!);
    const faq = ld["@graph"].find((n: { "@type": string }) => n["@type"] === "FAQPage");
    expect(faq.mainEntity[0]).toEqual({ "@type": "Question", name: brief.seo.questions[0]!.question, acceptedAnswer: { "@type": "Answer", text: "Written by a person" } });
    expect(html).toContain('id="form"');
    expect(html).toContain('name="_hp"');
  });

  it("renders a version on its own URL, canonical to the general page", async () => {
    const { page } = await finishedPage();
    const v = page.variants[0]!;
    const html = renderPage(page, brand, css, { origin: "https://northloop.example", variant: v.slug, noindex: true });
    expect(html).toContain(`<meta property="og:url" content="https://northloop.example/${page.slug}/${v.slug}"/>`);
    expect(html).toContain(`<link rel="canonical" href="https://northloop.example/${page.slug}"/>`);
    expect(html).toContain(`data-variant="${v.slug}"`);
    expect(html).toContain(v.overrides["hero.eyebrow"]!);
    expect(html).toContain('content="noindex, nofollow"');
  });

  it("escapes copy and drops unsafe links", async () => {
    const { page } = await finishedPage();
    const hero = page.blocks[0]!;
    if (hero.type !== "hero") throw new Error("no hero");
    hero.heading = '</script><script>alert(1)</script>';
    hero.primaryCta.href = "javascript:alert(1)";
    page.seo.title = "</title><script>alert(2)</script>";
    const faq = page.blocks.find((b) => b.type === "faq");
    if (faq?.type === "faq") faq.items[0]!.answer = "</script><script>alert(3)</script>";
    const html = renderPage(page, brand, css);
    expect(html).not.toMatch(/<script>alert/);
    expect(html).not.toContain("javascript:");
    expect(safeHref("//evil.example")).toBe("#");
    expect(safeHref("/pricing")).toBe("/pricing");
    expect(safeHref("mailto:sales@northloop.example")).toBe("mailto:sales@northloop.example");
  });

  it("picks the brand's buttons for each band", () => {
    // Northloop styles "secondary" for its green hero and "primary" for white sections.
    expect(buttonsFor(brand, "hero").primary).toBe("secondary");
    expect(buttonsFor(brand, "default").primary).toBe("primary");
    expect(buttonsFor(brand, "hero").visible).toBe(true);
  });

  it("previews the form without sending when there's no action", async () => {
    const { page } = await finishedPage();
    const form = renderPage(page, brand, css).match(/<form [^>]*>/)![0];
    expect(form).toContain("data-success=");
    expect(form).not.toContain("action=");
    expect(renderPage(page, brand, css, { formAction: "/api/forms/page-1" })).toContain('action="/api/forms/page-1"');
  });
});

describe("pageEdit", () => {
  it("accepts a stored page and rejects blocks the library doesn't have", async () => {
    const { page } = await makePage();
    expect(() => pageEdit.parse(page)).not.toThrow();
    expect(() => pageEdit.parse({ ...page, blocks: [{ ...page.blocks[0], type: "carousel" }] })).toThrow();
    expect(() => pageEdit.parse({ ...page, blocks: [{ ...page.blocks[0], id: "Not An Id" }] })).toThrow();
  });
});

describe("claude page generator", () => {
  const fakeClient = (reply: object) => {
    const calls: Record<string, unknown>[] = [];
    const client = { beta: { messages: { parse: async (params: Record<string, unknown>) => (calls.push(params), reply) } } } as unknown as Anthropic;
    return { client, calls };
  };

  it("pours the model's copy into the outline's structure", async () => {
    const brief = await makeBrief();
    const sections: PageCopy["sections"] = brief.outline.map((s) => ({
      type: s.type,
      eyebrow: "",
      heading: `Model ${s.type}`,
      body: `Body for ${s.type}`,
      items: [{ title: "One", body: "First", extra: "" }],
      quote: { text: "", name: "", role: "", company: "" },
      primaryCta: s.type === "hero" ? "Book a demo" : "",
      secondaryCta: "",
    }));
    const copy: PageCopy = { sections, versions: [{ personaId: brief.personas[0]!.id, eyebrow: "For RevOps", heading: "Route every lead in seconds", lead: "" }], seo: { title: "Model title", metaDescription: "" } };
    const { client, calls } = fakeClient({ stop_reason: "end_turn", parsed_output: copy });
    const gen = claudePageGenerator({ client });
    const draft = await gen.generate({ brief, brand });
    expect(draft.blocks.map((b) => b.type)).toEqual(brief.outline.map((s) => s.type));
    const hero = draft.blocks[0]!;
    expect(hero.type === "hero" && [hero.heading, hero.lead, hero.primaryCta.href]).toEqual(["Model hero", "Body for hero", "#form"]);
    // The testimonial had no quote, so it keeps the template's placeholder rather than an invented one.
    const testimonial = draft.blocks.find((b) => b.type === "testimonial");
    expect(testimonial?.type === "testimonial" && testimonial.quote).toContain(PLACEHOLDER);
    expect(draft.seo).toEqual({ title: "Model title", metaDescription: brief.seo.metaDescription });
    expect(draft.variants[0]!.overrides).toEqual({ "hero.eyebrow": "For RevOps", "hero.heading": "Route every lead in seconds" });
    const sent = JSON.stringify(calls[0]);
    expect(sent).toContain("<brief>");
    expect(sent).toContain("<outline>");
  });

  it("keeps the template's block when the model returns the wrong type", async () => {
    const brief = await makeBrief();
    const { page } = await makePage(brief);
    const wrong = { type: "faq" as const, eyebrow: "", heading: "Wrong", body: "", items: [], quote: { text: "", name: "", role: "", company: "" }, primaryCta: "", secondaryCta: "" };
    const out = applyCopy(page, { sections: [wrong], versions: [], seo: { title: "", metaDescription: "" } }, brand.name);
    expect(out.blocks[0]).toEqual(page.blocks[0]);
  });

  it("reports a refusal as a generation error", async () => {
    const { client } = fakeClient({ stop_reason: "refusal", parsed_output: null });
    await expect(claudePageGenerator({ client }).generate({ brief: await makeBrief(), brand })).rejects.toBeInstanceOf(GenerationError);
  });
});
