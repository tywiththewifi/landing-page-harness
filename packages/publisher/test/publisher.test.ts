import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseDocument, runGate, type GateReport } from "@lph/checks";
import { FORM_SCRIPT, renderVersions, type Page } from "@lph/page";
import { toCss } from "@lph/tokens";
import { brand, finishedPage, uiCss } from "../../checks/test/fixture.ts";
import { runtimeSources } from "../scripts/sync-runtime.ts";
import {
  DEFAULT_SITE,
  LABELS,
  classify,
  cloudflareBundle,
  crc32,
  github,
  handleForm,
  mergeForms,
  mergeHeaders,
  parseSource,
  planPublish,
  previewFor,
  siteFiles,
  beyondCopy,
  htmlSkeleton,
  warningsOf,
  zip,
  type FormConfig,
  type GateFindings,
  type PageSource,
  type SiteConfig,
} from "../src/index.ts";
import { fakeGitHub } from "./fake-github.ts";

const config: SiteConfig = { origin: "https://www.northloop.example", ...DEFAULT_SITE };
const css = await uiCss();

async function readyPage() {
  const { page, brief } = await finishedPage();
  page.blocks = page.blocks.filter((b) => b.type !== "testimonial");
  return { page, brief };
}

async function gateFor(page: Page, brief: Awaited<ReturnType<typeof finishedPage>>["brief"]): Promise<GateReport> {
  const versions = renderVersions(page, brand, css, { origin: config.origin, formAction: `/api/forms/${page.id}` });
  return runGate({ model: { page, brief, brand }, versions }, { environment: "browser", parse: parseDocument });
}

const sourceOf = async (page: Page, gate?: GateReport): Promise<PageSource> => parseSource((await siteFiles({ page, brand, uiCss: css, config, gate })).find((f) => f.kind === "source")!.content)!;
const READY: GateFindings = { verdict: "ready", warnings: [] };

describe("siteFiles", () => {
  it("writes each version's HTML at its URL, the page's source and the shared files", async () => {
    const { page } = await readyPage();
    const files = await siteFiles({ page, brand, uiCss: css, config, targets: { keyword: "hubspot integration", questions: [] } });
    const v = page.variants[0]!;
    expect(files.filter((f) => f.kind === "page").map((f) => f.path)).toEqual(["site/hubspot-integration.html", `site/hubspot-integration/${v.slug}.html`]);
    const html = files[0]!.content;
    expect(html).toContain('<link rel="canonical" href="https://www.northloop.example/hubspot-integration"/>');
    expect(html).toContain(`action="/api/forms/${page.id}"`);
    expect(html).not.toContain("noindex");

    const source = parseSource(files.find((f) => f.kind === "source")!.content)!;
    expect(source.page.id).toBe(page.id);
    expect(source.build.tokens).toBe(createHash("sha256").update(toCss(brand)).digest("hex"));
    expect(source.targets.keyword).toBe("hubspot integration");

    expect(files.filter((f) => f.kind === "config").map((f) => f.path)).toEqual([
      "site/_headers",
      "functions/_lph/forms.json",
      "functions/api/forms/[pageId].ts",
      "functions/_lph/forms/index.ts",
      "functions/_lph/forms/fields.ts",
      "functions/_lph/forms/submission.ts",
      "functions/_lph/forms/deliver.ts",
      "functions/_lph/handler.ts",
    ]);
    const forms = JSON.parse(files.find((f) => f.path.endsWith("forms.json"))!.content) as Record<string, FormConfig>;
    expect(forms[page.id]).toMatchObject({ connector: { kind: "hubspot", portalId: "123456" }, fields: expect.arrayContaining([expect.objectContaining({ name: "email", required: true })]) });
  });

  it("allows the page's one script by its hash, and keeps the site's own headers", async () => {
    const { page } = await readyPage();
    const read = async (path: string) => (path === "site/_headers" ? "/*\n  X-Robots-Tag: all\n" : null);
    const headers = (await siteFiles({ page, brand, uiCss: css, config, read })).find((f) => f.path === "site/_headers")!.content;
    const hash = createHash("sha256").update(FORM_SCRIPT).digest("base64");
    expect(headers).toContain(`script-src 'sha256-${hash}'`);
    expect(headers).toContain("style-src 'unsafe-inline' https://fonts.googleapis.com");
    expect(headers).toContain("form-action 'self'");
    expect(headers.startsWith("/*\n  X-Robots-Tag: all\n\n# lph:begin hubspot-integration\n/hubspot-integration\n")).toBe(true);
    // Publishing again replaces the page's block, and leaves other pages' blocks alone.
    const other = "# lph:begin pricing\n/pricing\n  X-Frame-Options: DENY\n# lph:end pricing";
    const twice = mergeHeaders(mergeHeaders(headers + "\n" + other, "hubspot-integration", "# lph:begin hubspot-integration\nNEW\n# lph:end hubspot-integration"), "hubspot-integration", "# lph:begin hubspot-integration\nNEWER\n# lph:end hubspot-integration");
    expect(twice.match(/lph:begin hubspot-integration/g)).toHaveLength(1);
    expect(twice).toContain("NEWER");
    expect(twice).toContain("X-Frame-Options: DENY");
    expect(twice).toContain("X-Robots-Tag: all");
  });

  it("keeps other pages' forms, and drops a page's when its form goes", async () => {
    const { page } = await readyPage();
    const existing = JSON.stringify({ other: { pageId: "other" } });
    expect(Object.keys(JSON.parse(mergeForms(existing, page)))).toEqual(["other", page.id]);
    const noForm = { ...page, blocks: page.blocks.filter((b) => b.type !== "form") };
    expect(Object.keys(JSON.parse(mergeForms(mergeForms(existing, page), noForm)))).toEqual(["other"]);
  });

  it("ships the form endpoint's code as it is in the repo", async () => {
    const generated = await readFile(new URL("../src/runtime/sources.ts", import.meta.url), "utf8");
    expect(generated, "Run pnpm --filter @lph/publisher sync-runtime").toBe(await runtimeSources());
  });
});

describe("classify", () => {
  it("lets a copy change on a live page merge itself, and nothing else", async () => {
    const { page } = await readyPage();
    const before = await sourceOf(page);
    const edited = structuredClone(page);
    const hero = edited.blocks[0]!;
    if (hero.type === "hero") hero.lead = "A sharper subheadline.";
    edited.variants[0]!.overrides["hero.heading"] = "A new H1 for RevOps";
    edited.seo.title = "A new title for the HubSpot integration page";
    const pageFile = { path: "site/hubspot-integration.html", kind: "page" as const, status: "changed" as const };
    expect(classify(before, await sourceOf(edited), [pageFile], READY).risk).toBe("content");

    const reason = async (change: (p: Page) => void, verdict: GateReport["verdict"] = "ready") => {
      const next = structuredClone(page);
      change(next);
      const c = classify(before, await sourceOf(next), [pageFile], { verdict, warnings: [] });
      expect(c.risk).toBe("review");
      return c.reasons.join(" ");
    };
    expect(await reason((p) => p.blocks.splice(2, 1))).toContain("Sections were added, removed or reordered");
    expect(await reason((p) => (p.blocks[1]!.tone = "brand"))).toContain("background or card style");
    expect(await reason((p) => p.blocks[0]!.type === "hero" && (p.blocks[0]!.primaryCta.href = "/pricing"))).toContain("Where a button links");
    expect(await reason((p) => (p.form.hubspotFormId = "11111111-1111-1111-1111-111111111111"))).toContain("where its leads go");
    expect(await reason((p) => (p.variants[0]!.slug = "revops"))).toContain("new URL");
    expect(await reason((p) => (p.slug = "hubspot"))).toContain("moves from /hubspot-integration to /hubspot");
    expect(await reason((p) => p.blocks.forEach((b) => b.type === "faq" && b.items.pop()))).toContain("Items were added to or removed from a section.");
    expect(await reason(() => {}, "review")).toContain("warnings");

    expect(classify(null, before, [pageFile], READY).reasons[0]).toContain("new page");
    const changedHeaders = classify(before, before, [{ path: "site/_headers", kind: "config", status: "changed" }], READY);
    expect(changedHeaders).toEqual({ risk: "review", reasons: ["Shared site files change: site/_headers."] });
    const tokens = classify(before, { ...before, build: { ...before.build, tokens: "other" } }, [pageFile], READY);
    expect(tokens.reasons[0]).toContain("tokens changed");
    const handEdited = classify(before, before, [{ ...pageFile, beyondCopy: true }], READY);
    expect(handEdited).toEqual({ risk: "review", reasons: ["More than the words changed in site/hubspot-integration.html: its tags, links, scripts or styles."] });
  });

  it("tells a copy edit from any other change to the HTML", async () => {
    const { page } = await finishedPage();
    const render = (p: Page) => renderVersions(p, brand, css, { origin: config.origin, formAction: `/api/forms/${p.id}` }).map((v) => v.html);
    const [general, version] = render(page);

    // Every kind of text: headings, buttons, FAQ answers, the quote, form labels, SEO text, a version's override.
    const copy = structuredClone(page);
    for (const b of copy.blocks) {
      if (b.type === "hero") Object.assign(b, { heading: "Route every lead in seconds", lead: "New words & <symbols>." }), (b.primaryCta.label = "Start now");
      if (b.type === "faq") b.items[0]!.answer = "A different answer, with \"quotes\".";
      if (b.type === "testimonial") b.quote = "Another quote.";
      if (b.type === "form") b.fields[0]!.label = "Your work email";
    }
    Object.assign(copy.seo, { title: "Another title for the page", metaDescription: "Another description of the page." });
    copy.variants[0]!.overrides["hero.heading"] = "A heading for RevOps";
    const [general2, version2] = render(copy);
    expect(general2).not.toBe(general);
    expect(htmlSkeleton(general2!)).toBe(htmlSkeleton(general!));
    expect(beyondCopy(version!, version2!)).toBe(false);

    // Hand edits that keep the words.
    const edits = [
      general!.replace(/href="[^"]*"/, 'href="https://evil.example/login"'),
      general!.replace("</body>", '<script src="https://evil.example/x.js"></script></body>'),
      general!.replace(/<h1/, '<h1 onclick="steal()"'),
      general!.replace(/<style>/, "<style>body{display:none}"),
      general!.replace(/("url":")[^"]*/, "$1https://evil.example/"),
      general!.replace(/<meta name="robots"[^>]*>|<\/title>/, '</title><meta http-equiv="refresh" content="0;url=https://evil.example">'),
      general!.replace('"@type":"FAQPage"', '"@type":"FAQPage"}</script><script>alert(1)</script><script type="application/ld+json">{"x":1'),
    ];
    for (const edited of edits) {
      expect(edited).not.toBe(general);
      expect(beyondCopy(general!, edited)).toBe(true);
    }
  });

  it("doesn't ask again about a warning a reviewer accepted, unless its text changed", async () => {
    // The testimonial's quote isn't on the site: a warning a person accepts once.
    const { page, brief } = await finishedPage();
    const gate = await gateFor(page, brief);
    const warnings = warningsOf(gate);
    expect(gate.verdict).toBe("review");
    expect(warnings.map((w) => w.id)).toContain("testimonial.quote-source");
    const live = await sourceOf(page, gate);
    expect(live.gate?.warnings).toEqual(warnings);
    const pageFile = { path: "site/hubspot-integration.html", kind: "page" as const, status: "changed" as const };

    // A new H1, the quote as it was: copy only.
    const edited = structuredClone(page);
    const hero = edited.blocks.find((b) => b.type === "hero")!;
    if (hero.type === "hero") hero.heading = "Route every HubSpot lead in seconds";
    const next = await gateFor(edited, brief);
    const c = classify(live, await sourceOf(edited, next), [pageFile], { verdict: next.verdict, warnings: warningsOf(next) });
    expect(c.risk).toBe("content");
    expect(c.reasons.join(" ")).toContain("accepted when the live page was reviewed");
    // The same warnings found again by the site's CI are counted once.
    const both = classify(live, await sourceOf(edited, next), [pageFile], { verdict: next.verdict, warnings: [...warningsOf(next), ...warningsOf(next)] });
    expect(both.reasons).toEqual(c.reasons);

    // A different quote is checked again.
    const quote = structuredClone(edited);
    const t = quote.blocks.find((b) => b.type === "testimonial")!;
    if (t.type === "testimonial") t.quote = "We cut lead routing from a day to a minute.";
    const again = await gateFor(quote, brief);
    const q = classify(live, await sourceOf(quote, again), [pageFile], { verdict: again.verdict, warnings: warningsOf(again) });
    expect(q).toEqual({ risk: "review", reasons: ["The checks found a new warning a person has to accept: testimonial.quote-source."] });

    // A page published without its warnings recorded gets no pass.
    const unrecorded = { ...live, gate: { ...live.gate!, warnings: [] } };
    expect(classify(unrecorded, await sourceOf(edited, next), [pageFile], { verdict: next.verdict, warnings: warningsOf(next) }).risk).toBe("review");
  });
});

describe("planPublish", () => {
  it("describes the pull request, previews each version and removes versions that went", async () => {
    const { page, brief } = await readyPage();
    const gate = await gateFor(page, brief);
    const base = await siteFiles({ page, brand, uiCss: css, config, gate });
    const files = new Map(base.map((f) => [f.path, f.content]));
    const removedPath = `site/hubspot-integration/${page.variants[0]!.slug}.html`;
    const next = structuredClone(page);
    next.variants = [];
    const plan = await planPublish({ page: next, brand, uiCss: css, config, gate, read: async (p) => files.get(p) ?? null, previewUrl: "https://{branch}.northloop-site.pages.dev" });
    expect(plan.branch).toBe("lph/hubspot-integration");
    expect(plan.removed).toEqual([removedPath]);
    expect(plan.changes.find((c) => c.path === removedPath)?.status).toBe("removed");
    expect(plan.classification.risk).toBe("review");
    expect(plan.labels).toEqual([LABELS.review]);
    expect(plan.previews).toEqual([{ name: "General", path: "/hubspot-integration", url: "https://lph-hubspot-integration.northloop-site.pages.dev/hubspot-integration" }]);
    expect(plan.title).toBe(`Update landing page: ${page.title}`);
    expect(plan.body).toContain("🟡 **Needs a reviewer.**");
    expect(plan.body).toContain("A version was added, removed or moved to a new URL.");
    expect(plan.body).toContain("| General | `/hubspot-integration` |");
    expect(plan.body).toContain("Ready: every check passed.");
    expect(plan.body).toContain(`| \`${removedPath}\` | removed |`);

    // Publishing the same thing again changes nothing.
    const again = await planPublish({ page, brand, uiCss: css, config, gate, read: async (p) => files.get(p) ?? null });
    expect(again.unchanged).toBe(true);
  });

  it("names branch previews the way Cloudflare Pages does", () => {
    expect(previewFor("https://{branch}.site.pages.dev/", "lph/Big_Launch", "/big-launch")).toBe("https://lph-big-launch.site.pages.dev/big-launch");
  });
});

describe("github", () => {
  const target = { repo: "northloop/site", base: "main", token: "test-token", reviewers: ["me", "ada", "northloop/web"] };

  it("opens a pull request for a new page, then lets a copy edit merge itself", async () => {
    const gh = fakeGitHub("northloop/site", { "site/_headers": "/*\n  X-Robots-Tag: all\n", "README.md": "Site" });
    const repo = github({ ...target, fetch: gh.fetch });
    const { page, brief } = await readyPage();

    let plan = await planPublish({ page, brand, uiCss: css, config, gate: await gateFor(page, brief), read: repo.read });
    const first = await repo.publish(plan);
    expect(first).toMatchObject({ number: 1, url: "https://github.com/northloop/site/pull/1", branch: "lph/hubspot-integration", created: true, unchanged: false });
    const pr = gh.pulls[0]!;
    expect([...pr.labels]).toEqual([LABELS.review]);
    expect(pr.reviewers).toEqual([]); // "me" can't review their own PR, so GitHub refused the whole request
    const onBranch = gh.filesOn("lph/hubspot-integration");
    expect(onBranch["README.md"]).toBe("Site");
    expect(onBranch["site/_headers"]).toContain("X-Robots-Tag: all");
    expect(onBranch["site/hubspot-integration.html"]).toContain("<h1");
    expect(onBranch["functions/_lph/handler.ts"]).toContain('from "./forms/index.ts"');

    gh.merge("lph/hubspot-integration");
    const edited = structuredClone(page);
    if (edited.blocks[0]!.type === "hero") edited.blocks[0]!.lead = "A sharper subheadline.";
    plan = await planPublish({ page: edited, brand, uiCss: css, config, gate: await gateFor(edited, brief), read: repo.read });
    expect(plan.classification.risk).toBe("content");
    // The persona's version has its own subheadline, so only the general page's HTML changes.
    expect(plan.changes.filter((c) => c.status !== "unchanged").map((c) => c.path)).toEqual(["site/hubspot-integration.html", ".lph/pages/hubspot-integration.json"]);
    const second = await repo.publish(plan, { expectedHead: first.commit });
    expect(second).toMatchObject({ number: 2, created: true });
    expect([...gh.pulls[1]!.labels]).toEqual([LABELS.content]);
    expect(gh.filesOn("lph/hubspot-integration")["site/hubspot-integration.html"]).toContain("A sharper subheadline.");
  });

  it("updates the open pull request, and won't overwrite someone else's push", async () => {
    const gh = fakeGitHub("northloop/site");
    const repo = github({ ...target, reviewers: ["ada", "northloop/web"], fetch: gh.fetch });
    const { page, brief } = await readyPage();
    const gate = await gateFor(page, brief);
    const first = await repo.publish(await planPublish({ page, brand, uiCss: css, config, gate, read: repo.read }));
    expect(gh.pulls[0]).toMatchObject({ reviewers: ["ada"], teams: ["web"] });

    // The same page again: the branch already has it, so only the description is refreshed.
    const same = await repo.publish(await planPublish({ page, brand, uiCss: css, config, gate, read: repo.read }), { expectedHead: first.commit });
    expect(same).toMatchObject({ number: 1, created: false, unchanged: true, commit: first.commit });

    gh.push("lph/hubspot-integration", "site/hubspot-integration.html", "hand edit");
    const edited = structuredClone(page);
    edited.seo.title = "Another title for the HubSpot integration";
    const plan = await planPublish({ page: edited, brand, uiCss: css, config, gate, read: repo.read });
    await expect(repo.publish(plan, { expectedHead: first.commit })).rejects.toThrow(/Someone pushed/);
    expect(gh.pulls).toHaveLength(1);
  });

  it("explains a refused token", async () => {
    const gh = fakeGitHub("northloop/site");
    const repo = github({ ...target, token: "wrong", fetch: gh.fetch });
    await expect(repo.read("site/_headers")).rejects.toThrow("GitHub refused the token");
  });
});

describe("the site's form endpoint", () => {
  const config: FormConfig = {
    pageId: "page-1",
    pageName: "HubSpot integration",
    fields: [{ name: "email", label: "Work email", required: true }],
    successMessage: "Thanks, we'll be in touch.",
    connector: { kind: "webhook", url: "https://hooks.example.com/lead" },
  };
  const post = (body: string, accept = "application/json") =>
    new Request("https://www.northloop.example/api/forms/page-1", { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", accept, referer: "https://www.northloop.example/hubspot-integration", "cf-connecting-ip": "203.0.113.9" } });

  it("sends a lead on, signed, and keeps it when KV is bound", async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    const kept: string[] = [];
    const res = await handleForm(post("email=ada%40example.com&variant=revops&pageUri=https%3A%2F%2Fwww.northloop.example%2Fhubspot-integration"), config, {
      LPH_WEBHOOK_SECRET: "s3cret",
      LEADS: { put: async (_key, value) => void kept.push(value) },
    }, { fetch: async (url, init) => (sent.push({ url: String(url), init: init! }), new Response("ok")) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, message: "Thanks, we'll be in touch." });
    expect(sent[0]!.url).toBe("https://hooks.example.com/lead");
    expect((sent[0]!.init.headers as Record<string, string>)["x-lph-signature"]).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(JSON.parse(kept[0]!)).toMatchObject({ values: { email: "ada@example.com" }, context: { variant: "revops" }, delivery: { status: "sent", connector: "webhook" } });
  });

  it("answers a plain form post with a page, and checks the fields", async () => {
    const res = await handleForm(post("email=nope", "text/html,application/xhtml+xml"), config, {});
    expect(res.status).toBe(422);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("Enter a valid work email.");
    expect((await handleForm(post("email=a%40b.co&_hp=bot"), config, {}, { fetch: async () => { throw new Error("must not send"); } })).status).toBe(200);
    expect((await handleForm(post("email=a%40b.co"), undefined, {})).status).toBe(404);
    const failed = await handleForm(post("email=a%40b.co", "text/html"), config, {}, { fetch: async () => new Response("no", { status: 500 }) });
    expect(failed.status).toBe(502);
    expect(await failed.text()).toContain("Back to the page");
  });
});

describe("the Cloudflare bundle", () => {
  it("is the site's files plus what wrangler needs, as a valid zip", async () => {
    const { page } = await readyPage();
    const files = await cloudflareBundle({ page, brand, uiCss: css, config: { ...config, publicDir: "public", functionsDir: null } });
    const paths = files.map((f) => f.path);
    expect(paths).toEqual(expect.arrayContaining(["site/hubspot-integration.html", "site/_headers", "functions/api/forms/[pageId].ts", "wrangler.toml", "lph.json", "README.md"]));
    expect(files.find((f) => f.path === "wrangler.toml")!.content).toContain('pages_build_output_dir = "site"');

    const bytes = zip(files);
    // Read the central directory back and check every entry's CRC.
    const view = new DataView(bytes.buffer);
    const end = bytes.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(files.length);
    let at = view.getUint32(end + 16, true);
    for (const f of files) {
      expect(view.getUint32(at, true)).toBe(0x02014b50);
      const nameLength = view.getUint16(at + 28, true);
      const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
      expect(name).toBe(f.path);
      const local = view.getUint32(at + 42, true);
      const size = view.getUint32(at + 20, true);
      const data = bytes.subarray(local + 30 + nameLength, local + 30 + nameLength + size);
      expect(crc32(data)).toBe(view.getUint32(at + 16, true));
      at += 46 + nameLength;
    }
  });
});
