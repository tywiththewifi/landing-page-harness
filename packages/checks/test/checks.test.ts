import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PLACEHOLDER } from "@lph/brief";
import { renderPage, renderVersions, type Page } from "@lph/page";
import {
  DEFAULT_BUDGET,
  axeIssues,
  brandLint,
  gateMarkdown,
  mergeVersions,
  parseDocument,
  perfIssues,
  runGate,
  seoLint,
  serverRunner,
  staticPerf,
  type GateIssue,
  type GateRunner,
} from "../src/index.ts";
import { brand, finishedPage, uiCss } from "./fixture.ts";

const ORIGIN = "https://northloop.example";
const ids = (issues: GateIssue[]) => issues.map((i) => i.id);

/** A finished page whose quote is the site's own, so nothing needs a reviewer. */
async function readyPage() {
  const { page, brief } = await finishedPage();
  const quote = page.blocks.find((b) => b.type === "testimonial");
  if (quote?.type === "testimonial") page.blocks.splice(page.blocks.indexOf(quote), 1);
  return { page, brief };
}

async function published(page: Page) {
  return renderVersions(page, brand, await uiCss(), { origin: ORIGIN, formAction: "/api/forms/page-1" });
}

/** The HTML checks only; enough for most tests. */
const htmlOnly: GateRunner = { environment: "browser", parse: parseDocument };

describe("seoLint", () => {
  it("passes the published page, and expects noindex only on previews", async () => {
    const { page, brief } = await readyPage();
    const [general] = await published(page);
    const ctx = { path: general!.path, general: true, mode: "publish" as const, keyword: brief.seo.primaryKeyword, questions: brief.seo.questions.map((q) => q.question) };
    const issues = seoLint(parseDocument(general!.html), ctx);
    expect(issues.filter((i) => i.severity !== "info")).toEqual([]);

    const preview = renderPage(page, brand, await uiCss(), { noindex: true });
    const found = ids(seoLint(parseDocument(preview), ctx));
    expect(found).toContain("seo.noindex");
    expect(found).toContain("seo.canonical");
    expect(ids(seoLint(parseDocument(preview), { ...ctx, mode: "preview" }))).not.toContain("seo.noindex");
  });

  it("catches what a crawler or answer engine would trip on", () => {
    const html = `<!doctype html><html><head><title>Hi</title>
      <script type="application/ld+json">{"@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Is it free?"}]}</script>
      <script type="application/ld+json">{broken</script></head>
      <body><h1>One</h1><h1>Two</h1><a href="#nowhere">Go</a><a href="http://example.com">Old</a><a href="javascript:alert(1)">JS</a></body></html>`;
    const issues = seoLint(parseDocument(html), { path: "/Bad_URL", general: true, mode: "publish", questions: ["How long does setup take?"] });
    const errors = ids(issues.filter((i) => i.severity === "error"));
    expect(errors).toEqual(expect.arrayContaining(["seo.lang", "seo.viewport", "seo.description", "seo.h1", "seo.canonical", "seo.json-ld", "seo.faq-visible", "seo.link"]));
    expect(issues.filter((i) => i.id === "seo.link").map((i) => i.severity).sort()).toEqual(["error", "error", "warning"]);
    expect(ids(issues)).toEqual(expect.arrayContaining(["seo.title-length", "seo.url", "seo.aeo-question", "seo.json-ld-webpage"]));
  });

  it("matches a planned question to the one the page asks, worded a little differently", () => {
    const html = `<html lang="en"><body><main><details><summary>How long does the setup take?</summary><p>A day.</p></details></main></body></html>`;
    const ask = (q: string) => ids(seoLint(parseDocument(html), { path: "/x", general: false, mode: "preview", questions: [q] }));
    expect(ask("How long does setup take?")).not.toContain("seo.aeo-question");
    expect(ask("What does it cost?")).toContain("seo.aeo-question");
  });
});

describe("brandLint", () => {
  it("passes the page the renderer makes", async () => {
    const [general] = await published((await readyPage()).page);
    expect(brandLint(parseDocument(general!.html), general!.path, brand).filter((i) => i.severity !== "info")).toEqual([]);
  });

  it("flags anything that skips the tokens or the brand's styles", () => {
    const html = `<html><head><style>:root{--color-ink:#111}.lph-button--primary{} a{color:var(--color-ink);background:var(--color-brand);border-color:var(--color-border,#ccc)}</style></head>
      <body><p style="color:red">Red</p><a class="lph-button lph-button--primary">Ok</a><a class="lph-button lph-button--shiny">No</a>
      <svg style="fill:red" color="red"></svg></body></html>`;
    const issues = brandLint(parseDocument(html), "/x", brand);
    const by = (id: string) => issues.find((i) => i.id === id);
    expect(by("brand.inline-style")).toMatchObject({ severity: "error", nodes: ["p"] });
    expect(by("brand.token-missing")?.message).toContain("--color-brand");
    expect(by("brand.token-default")?.message).toContain("--color-border");
    expect(by("brand.button-style")?.message).toContain("shiny");
    expect(by("brand.font-heading")?.severity).toBe("warning");
  });
});

describe("axeIssues", () => {
  it("blocks serious WCAG failures and leaves the rest to a reviewer", () => {
    const node = { target: ["main > img"] };
    const rule = (id: string, impact: "minor" | "serious", tags: string[]) => ({ id, impact, tags, help: id, helpUrl: `https://dequeuniversity.com/rules/axe/${id}`, nodes: [node] });
    const issues = axeIssues(
      {
        violations: [rule("image-alt", "serious", ["wcag2a"]), rule("link-in-text-block", "minor", ["wcag2a"]), rule("region", "minor", ["best-practice"])],
        incomplete: [rule("color-contrast", "serious", ["wcag2aa"])],
      },
      "/x",
    );
    expect(issues.map((i) => [i.id, i.severity])).toEqual([
      ["a11y.image-alt", "error"],
      ["a11y.link-in-text-block", "warning"],
      ["a11y.region", "info"],
      ["a11y.color-contrast", "info"],
    ]);
    expect(issues[0]).toMatchObject({ help: "https://dequeuniversity.com/rules/axe/image-alt", nodes: ["main > img"] });
  });
});

describe("performance budget", () => {
  it("reads what the HTML costs and checks it against the budget", async () => {
    const html = `<html><head><link rel="stylesheet" href="https://fonts.example/a.css"><link rel="stylesheet" media="print" href="/p.css"><script src="/a.js"></script><script src="/b.js" defer></script>
      <style>@font-face{src:url(/f.woff2)}</style></head><body><img src="/x.png"></body></html>`;
    const doc = parseDocument(html);
    const sample = await staticPerf(html, doc, "/x");
    expect(sample).toMatchObject({ requests: 6, renderBlocking: 2, transferBytes: null, lcpMs: null });
    expect(sample.htmlGzipBytes).toBeGreaterThan(0);
    const issues = perfIssues([{ ...sample, lcpMs: 5000, cls: 0.12 }], DEFAULT_BUDGET, () => doc);
    expect(issues.map((i) => [i.id, i.severity])).toEqual([
      ["performance.lcpMs", "error"],
      ["performance.cls", "warning"],
      ["performance.image-size", "info"],
    ]);
  });
});

describe("runGate", () => {
  it("merges issues every version shares, and keeps the ones that aren't", () => {
    const issue = (path: string, message = "Same") => ({ id: "seo.x", check: "seo" as const, severity: "warning" as const, message, path });
    expect(mergeVersions([issue("/a"), issue("/a/b")], ["/a", "/a/b"])).toEqual([{ id: "seo.x", check: "seo", severity: "warning", message: "Same" }]);
    expect(mergeVersions([issue("/a"), issue("/a/b", "Other")], ["/a", "/a/b"])).toHaveLength(2);
  });

  it("is ready when nothing needs fixing, and needs a reviewer for an unsourced quote", async () => {
    const { page, brief } = await readyPage();
    const report = await runGate({ model: { page, brief, brand }, versions: await published(page) }, htmlOnly);
    expect(report.checks.map((c) => [c.id, c.status])).toEqual([
      ["content", "pass"],
      ["brand", "pass"],
      ["seo", "pass"],
      ["a11y", "skipped"],
      ["performance", "pass"],
    ]);
    expect(report.verdict).toBe("ready");
    expect(report.versions.map((v) => v.path)).toEqual(["/hubspot-integration", "/hubspot-integration/revops-leads-at-saas-companies"]);

    const withQuote = await finishedPage();
    const review = await runGate({ model: { ...withQuote, brand }, versions: await published(withQuote.page) }, htmlOnly);
    expect(review.verdict).toBe("review");
    expect(gateMarkdown(review)).toContain("Passed with warnings");
  });

  it("blocks unfinished copy, and points back at the field and version", async () => {
    const { page, brief } = await readyPage();
    const v = page.variants[0]!;
    v.overrides["hero.lead"] = `${PLACEHOLDER} for this persona`;
    const report = await runGate({ model: { page, brief, brand }, versions: await published(page) }, htmlOnly);
    expect(report.verdict).toBe("blocked");
    const issue = report.checks.find((c) => c.id === "content")!.issues.find((i) => i.severity === "error");
    expect(issue).toMatchObject({ area: "hero", variant: v.id, field: "hero.lead", path: `/hubspot-integration/${v.slug}` });
  });
});

describe("serverRunner (Chromium)", () => {
  let runner: Awaited<ReturnType<typeof serverRunner>>;
  let hits = 0;
  const local = createServer((_req, res) => {
    hits++;
    res.end("body{}");
  });
  beforeAll(async () => {
    await new Promise<void>((r) => local.listen(0, "127.0.0.1", r));
    runner = await serverRunner({ allowAddress: (ip) => !ip.startsWith("127.") });
  });
  afterAll(async () => {
    await runner.close();
    local.close();
  });

  it("runs axe and finds real problems", async () => {
    const html = `<!doctype html><html lang="en"><head><title>x</title></head><body><main><h1>Hi</h1><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><p style="color:#bbb;background:#fff">Faint</p></main></body></html>`;
    const outcome = await runner.axe!(html, { path: "/x", viewport: "mobile" });
    const found = axeIssues(outcome, "/x");
    expect(found.find((i) => i.id === "a11y.image-alt")?.severity).toBe("error");
    expect(found.find((i) => i.id === "a11y.color-contrast")?.severity).toBe("error");
  });

  it("measures the page and refuses requests to private addresses", async () => {
    const { port } = local.address() as AddressInfo;
    const html = `<!doctype html><html lang="en"><head><link rel="stylesheet" href="http://127.0.0.1:${port}/font.css"></head><body><h1>Hello</h1></body></html>`;
    const lab = await runner.measure!(html, "/x");
    expect(hits).toBe(0);
    expect(lab.requests).toBe(1);
    expect(lab.lcpMs).toBeGreaterThan(0);
    expect(lab.cls).toBe(0);
    expect(lab.domNodes).toBeGreaterThan(4);
  });

  it("passes the published page on every check", async () => {
    const { page, brief } = await readyPage();
    const report = await runGate({ model: { page, brief, brand }, versions: await published(page) }, runner);
    const failing = report.checks.flatMap((c) => c.issues.filter((i) => i.severity !== "info"));
    expect(failing).toEqual([]);
    expect(report.checks.find((c) => c.id === "a11y")?.status).toBe("pass");
    expect(report.performance.every((s) => s.lcpMs !== null && s.transferBytes! > s.htmlBytes - 1)).toBe(true);
  });
});
