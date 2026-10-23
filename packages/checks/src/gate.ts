import type { Brief } from "@lph/brief/browser";
import { checkPage, versionPath, type Page } from "@lph/page/browser";
import type { Brand } from "@lph/tokens";
import { axeIssues, type AxeOutcome } from "./axe.ts";
import { brandLint } from "./brand.ts";
import { perfIssues, staticPerf } from "./performance.ts";
import { seoLint } from "./seo.ts";
import { CHECK_TITLES, DEFAULT_BUDGET, count, plural, statusOf, verdictOf, type Budget, type CheckId, type CheckResult, type GateIssue, type GateReport, type PerfSample } from "./types.ts";

/** One version of the page, rendered as it will be published. */
export interface RenderedVersion {
  slug: string | null;
  name: string;
  path: string;
  html: string;
}

export interface GateInput {
  versions: RenderedVersion[];
  /**
   * The page, its brief and the brand, when known (the studio and the API). Adds the
   * content checks and the brand checks that need the brand. A site repo's CI has the
   * HTML only, and checks that.
   */
  model?: { page: Page; brief: Brief; brand: Brand };
  /** The brief's search targets when there's no model: CI reads them from the page source. */
  targets?: { keyword: string; questions: string[] };
  /** "publish" (the default) checks what goes live; "preview" expects noindex. */
  mode?: "publish" | "preview";
  budget?: Budget;
}

/**
 * What the environment can do. The server parses with linkedom and runs axe and the lab
 * measurements in Chromium; the studio's demo parses with DOMParser and runs axe in a
 * hidden frame, without timings.
 */
export interface GateRunner {
  environment: GateReport["environment"];
  parse(html: string): Document;
  axe?(html: string, opts: { path: string; viewport: "mobile" | "desktop" }): Promise<AxeOutcome>;
  measure?(html: string, path: string): Promise<Partial<PerfSample>>;
}

/** checkPage issues that are about the brand rather than the copy. */
const BRAND_ISSUE = /(^|:)([^.]+\.(card|buttons)|page\.casing)$/;

/** The page model's checks, as gate issues that keep the editor's pointer to the field. */
export function contentIssues(page: Page, brief: Brief, brand: Brand): GateIssue[] {
  return checkPage(page, brief, brand).map((i) => {
    const variant = i.variant ? page.variants.find((v) => v.id === i.variant) : undefined;
    return {
      id: i.id,
      check: BRAND_ISSUE.test(i.id) ? "brand" : "content",
      severity: i.severity,
      message: i.message,
      area: i.area,
      ...(i.variant && { variant: i.variant }),
      ...(i.path && { field: i.path }),
      ...(variant && { path: versionPath(page, variant) }),
    };
  });
}

/**
 * The same issue on every version is reported once, for the whole page. An issue on
 * some versions only keeps its path.
 */
export function mergeVersions(issues: GateIssue[], paths: string[]): GateIssue[] {
  const groups = new Map<string, GateIssue[]>();
  for (const i of issues) {
    const key = `${i.id}\u0000${i.severity}\u0000${i.message}`;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  const out: GateIssue[] = [];
  for (const group of groups.values()) {
    const where = new Set(group.map((i) => i.path));
    if (paths.length > 1 && paths.every((p) => where.has(p))) {
      const { path: _, ...one } = group[0]!;
      out.push(one);
    } else out.push(...group.filter((i, n) => group.findIndex((x) => x.path === i.path) === n));
  }
  return out;
}

function summarise(id: CheckId, issues: GateIssue[], what: string): CheckResult {
  const errors = count(issues, "error");
  const warnings = count(issues, "warning");
  const status = statusOf(issues);
  const summary =
    status === "pass"
      ? `${what}: nothing to fix${count(issues, "info") ? `, ${plural(count(issues, "info"), "note")}` : ""}.`
      : [errors && plural(errors, "error"), warnings && plural(warnings, "warning")].filter(Boolean).join(", ") + ".";
  return { id, title: CHECK_TITLES[id], status, summary, issues };
}

const skipped = (id: CheckId, summary: string): CheckResult => ({ id, title: CHECK_TITLES[id], status: "skipped", summary, issues: [] });

/**
 * The pre-publish gate. Every version is checked as the HTML that will be published:
 * the page model's content checks, brand, SEO and answer engines, accessibility (axe)
 * and a performance budget. An error blocks publishing; a warning means a person has
 * to approve the pull request.
 */
export async function runGate(input: GateInput, runner: GateRunner, opts: { now?: Date; onProgress?: (step: string) => void } = {}): Promise<GateReport> {
  const { model, versions } = input;
  const mode = input.mode ?? "publish";
  const targets = model ? { keyword: model.brief.seo.primaryKeyword, questions: model.brief.seo.questions.map((q) => q.question) } : input.targets;
  const budget = input.budget ?? DEFAULT_BUDGET;
  const progress = opts.onProgress ?? (() => {});
  const paths = versions.map((v) => v.path);

  progress("Checking the copy");
  const content = model ? contentIssues(model.page, model.brief, model.brand) : [];
  const seo: GateIssue[] = [];
  const brandFound: GateIssue[] = [];
  const a11y: GateIssue[] = [];
  const samples: PerfSample[] = [];
  const docs = new Map<string, Document>();

  for (const v of versions) {
    const doc = runner.parse(v.html);
    docs.set(v.path, doc);
    seo.push(
      ...seoLint(doc, {
        path: v.path,
        general: v.slug === null,
        mode,
        keyword: targets?.keyword,
        questions: targets?.questions,
        modelChecked: !!model,
      }),
    );
    brandFound.push(...brandLint(doc, v.path, model?.brand));

    const sample = await staticPerf(v.html, doc, v.path);
    if (runner.measure) {
      progress(`Measuring ${v.path}`);
      Object.assign(sample, await runner.measure(v.html, v.path));
    }
    samples.push(sample);

    if (runner.axe) {
      progress(`Checking accessibility of ${v.path}`);
      const found = axeIssues(await runner.axe(v.html, { path: v.path, viewport: "mobile" }), v.path);
      // The general page is checked at desktop width too: layouts and targets change.
      if (v.slug === null) found.push(...axeIssues(await runner.axe(v.html, { path: v.path, viewport: "desktop" }), v.path));
      a11y.push(...found.filter((i, n) => found.findIndex((x) => x.id === i.id && x.severity === i.severity) === n));
    }
  }

  const checks: CheckResult[] = [
    model ? summarise("content", content.filter((i) => i.check === "content"), "Copy, links, the form and versions") : skipped("content", "The copy is checked in the studio, against the brief."),
    summarise("brand", [...content.filter((i) => i.check === "brand"), ...mergeVersions(brandFound, paths)], "Tokens, components, fonts"),
    summarise("seo", mergeVersions(seo, paths), "Search and answer engines"),
    runner.axe ? summarise("a11y", mergeVersions(a11y, paths), "WCAG 2.2 AA and best practices") : skipped("a11y", "Accessibility runs in a browser."),
    summarise("performance", mergeVersions(perfIssues(samples, budget, (p) => docs.get(p)), paths), runner.measure ? "Size, requests and lab timings" : "Size and requests (timings run on the server)"),
  ];

  return {
    pageId: model?.page.id ?? "",
    pageUpdatedAt: model?.page.updatedAt ?? "",
    ranAt: (opts.now ?? new Date()).toISOString(),
    environment: runner.environment,
    verdict: verdictOf(checks),
    checks,
    versions: versions.map(({ slug, name, path }) => ({ slug, name, path })),
    performance: samples,
    budget,
  };
}
