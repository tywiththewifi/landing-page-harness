import type { Brief, BriefIssue } from "@lph/brief";
import type { GateReport } from "@lph/checks";
import type { Page, PageIssue } from "@lph/page";
import type { Brand } from "@lph/tokens";
import { ApiError, type ApiClient } from "./client.ts";
import { brandSummary, briefSummary, gateSummary, pageSummary } from "./summary.ts";

export interface RunInput {
  url: string;
  productUrl?: string;
  /** What the page is for. Defaults to a landing page for the brand. */
  prompt?: string;
  /** Run the publish gate (axe and lab timings in Chromium). Defaults to true. */
  gate?: boolean;
}

export type Stage = "import" | "brief" | "page" | "gate";

/**
 * One URL through every phase: import the brand, write a brief, build the page and run
 * the publish gate. It stops at the first stage that fails or is blocked, and says why,
 * so a run against any site ends with a report rather than an exception.
 */
export interface RunReport {
  url: string;
  /** The prompt the brief was written from (empty if the import failed before a default was chosen). */
  prompt: string;
  /** The last stage that finished. */
  reached: Stage | null;
  /** Why the run stopped early, if it did. */
  stopped?: { stage: Stage; reason: string; issues?: string[] };
  seconds: Partial<Record<Stage, number>>;
  brand?: ReturnType<typeof brandSummary>;
  brief?: ReturnType<typeof briefSummary>;
  page?: ReturnType<typeof pageSummary>;
  gate?: ReturnType<typeof gateSummary>;
  /** Where to look at each result. */
  links: Record<string, string>;
}

/** The prompt when none is given: a page about the brand itself. */
export const defaultPrompt = (brand: Pick<Brand, "name">) => `Landing page for ${brand.name}`;

export async function runFromUrl(api: ApiClient, input: RunInput, onStep: (step: string) => void = () => {}): Promise<RunReport> {
  const report: RunReport = { url: input.url, prompt: input.prompt?.trim() ?? "", reached: null, seconds: {}, links: {} };

  const stage = async <T>(name: Stage, step: string, work: () => Promise<T>): Promise<T | null> => {
    onStep(step);
    const started = performance.now();
    try {
      return await work();
    } catch (err) {
      const issues = err instanceof ApiError ? ((err.body as { issues?: { message: string; severity?: string }[] })?.issues ?? []).map((i) => (i.severity ? `${i.severity}: ${i.message}` : i.message)) : [];
      report.stopped = { stage: name, reason: err instanceof Error ? err.message : String(err), ...(issues.length && { issues }) };
      return null;
    } finally {
      report.seconds[name] = Math.round((performance.now() - started) / 100) / 10;
    }
  };

  const brand = await stage("import", `Importing the brand from ${input.url}`, () => api.json<Brand>("POST", "/api/brands?wait=true", { url: input.url, productUrl: input.productUrl }));
  if (!brand) return report;
  report.reached = "import";
  report.brand = brandSummary(brand);
  const prompt = (report.prompt ||= defaultPrompt(brand));
  Object.assign(report.links, {
    brandPreview: api.link(`/api/brands/${brand.id}/preview.html`),
    designMd: api.link(`/api/brands/${brand.id}/design.md`),
    tokensCss: api.link(`/api/brands/${brand.id}/tokens.css`),
  });

  const brief = await stage("brief", "Writing the brief", async () => {
    const brief = await api.json<Brief>("POST", `/api/brands/${brand.id}/briefs?wait=true`, { prompt });
    return { brief, issues: await api.json<BriefIssue[]>("GET", `/api/briefs/${brief.id}/check`) };
  });
  if (!brief) return report;
  report.reached = "brief";
  report.brief = briefSummary(brief.brief, brief.issues);
  report.links.briefMd = api.link(`/api/briefs/${brief.brief.id}/brief.md`);

  const page = await stage("page", "Building the page", async () => {
    const page = await api.json<Page>("POST", `/api/briefs/${brief.brief.id}/pages?wait=true`);
    return { page, issues: await api.json<PageIssue[]>("GET", `/api/pages/${page.id}/check`) };
  });
  if (!page) return report;
  report.reached = "page";
  report.page = pageSummary(page.page, page.issues);
  report.links.page = api.link(`/api/pages/${page.page.id}/page.html`);
  for (const v of page.page.variants) report.links[`page:${v.slug}`] = api.link(`/api/pages/${page.page.id}/page.html?version=${encodeURIComponent(v.slug)}`);

  if (input.gate === false) return report;
  const gate = await stage("gate", "Running the publish checks", () => api.json<GateReport>("POST", `/api/pages/${page.page.id}/gate?wait=true`));
  if (!gate) return report;
  report.reached = "gate";
  report.gate = gateSummary(gate);
  report.links.gate = api.link(`/api/pages/${page.page.id}/gate`);
  return report;
}

/** The report as Markdown, for people. */
export function reportMarkdown(r: RunReport): string {
  const lines: string[] = [`# ${r.brand?.name ?? r.url}`, "", `- URL: ${r.url}`, `- Prompt: ${r.prompt}`, `- Reached: ${r.reached ?? "nothing"}${r.stopped ? `, stopped at ${r.stopped.stage}` : ""}`];
  lines.push(`- Time: ${Object.entries(r.seconds).map(([s, n]) => `${s} ${n}s`).join(", ")}`);
  if (r.stopped) {
    lines.push("", "## Stopped", "", `At **${r.stopped.stage}**: ${r.stopped.reason}`);
    for (const i of r.stopped.issues ?? []) lines.push(`- ${i}`);
  }
  if (r.brand) {
    const b = r.brand;
    lines.push("", "## Brand", "", `Pages sampled: ${b.pagesSampled.join(", ")}`, "", `Fonts: ${b.fonts.heading} (headings), ${b.fonts.body} (body). Logo: ${b.logo}. Cards: ${b.cards}.`, "");
    lines.push("| Colour | Value | Role | Confidence |", "|---|---|---|---|", ...b.colors.map((c) => `| ${c.name} | \`${c.value}\` | ${c.role} | ${c.confidence} |`));
    lines.push("", "Buttons:", ...b.buttons.map((x) => `- ${x}`));
    if (b.conflicts.length) lines.push("", "Conflicts:", ...b.conflicts.map((c) => `- ${c.message} (${c.options.join(" / ")})`));
    if (b.warnings.length) lines.push("", "Warnings:", ...b.warnings.map((w) => `- ${w}`));
  }
  if (r.brief) {
    const b = r.brief;
    lines.push("", "## Brief", "", `${b.title} (${b.generator}). Objective: ${b.objective.replace(/[.\s]+$/, "")}. CTA: "${b.cta}". Keyword: "${b.primaryKeyword}".`, `Personas: ${b.personas.join(", ")}. Outline: ${b.outline.join(" → ")}.`);
    lines.push("", `Check: ${b.check.errors} errors, ${b.check.warnings} warnings, ${b.check.info} info.`, ...b.check.issues.map((i) => `- ${i}`));
  }
  if (r.page) {
    const p = r.page;
    lines.push("", "## Page", "", `"${p.h1}" at /${p.slug}. Blocks: ${p.blocks.join(", ")}. Versions: ${p.versions.map((v) => `/${p.slug}/${v.slug}`).join(", ") || "none"}.`);
    lines.push("", `Check: ${p.check.errors} errors, ${p.check.warnings} warnings, ${p.check.info} info.`, ...p.check.issues.map((i) => `- ${i}`));
  }
  if (r.gate) {
    lines.push("", "## Publish gate", "", `Verdict: **${r.gate.verdict}**`, "", "| Check | Status | Summary |", "|---|---|---|", ...r.gate.checks.map((c) => `| ${c.check} | ${c.status} | ${c.summary} |`));
    for (const c of r.gate.checks) if (c.issues.length) lines.push("", `${c.check}:`, ...c.issues.map((i) => `- ${i}`));
  }
  lines.push("", "## Links", "", ...Object.entries(r.links).map(([k, v]) => `- ${k}: ${v}`));
  return lines.join("\n") + "\n";
}
