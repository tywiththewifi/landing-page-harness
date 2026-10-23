import { gateMarkdown, type GateReport } from "@lph/checks/browser";
import { applyVariant, versionPath, type Page } from "@lph/page/browser";
import type { Brand } from "@lph/tokens";
import { classify, LABELS, type Classification, type FileChange } from "./classify.ts";
import { htmlFile, parseSource, siteFiles, sourceFile, warningsOf, type PageSource, type SiteConfig, type SiteFile } from "./site.ts";
import { beyondCopy } from "./skeleton.ts";

export interface PublishPlan {
  branch: string;
  title: string;
  body: string;
  labels: string[];
  /** Files to write, and paths to delete (a version that was removed). */
  files: SiteFile[];
  removed: string[];
  changes: FileChange[];
  classification: Classification;
  /** A preview URL per version, when the host makes branch previews. */
  previews: { name: string; path: string; url: string }[];
  /** Nothing differs from the base branch. */
  unchanged: boolean;
}

export interface PlanInput {
  page: Page;
  brand: Brand;
  uiCss: string;
  config: SiteConfig;
  gate: GateReport | null;
  targets?: PageSource["targets"];
  /** Reads a file on the base branch (or the page's branch, when it exists). Null when it's not there. */
  read: (path: string) => Promise<string | null>;
  /** e.g. "https://{branch}.my-site.pages.dev": where the host previews a branch. */
  previewUrl?: string;
}

export const branchFor = (page: Pick<Page, "slug">) => `lph/${page.slug}`;

/**
 * Cloudflare Pages previews a branch at <branch>.<project>.pages.dev, with the branch
 * name lowercased and each character but letters and digits turned into a hyphen.
 */
export function previewFor(template: string, branch: string, path: string): string {
  const alias = branch.toLowerCase().replace(/[^a-z0-9]/g, "-");
  const base = template.replace("{branch}", alias).replace(/\/+$/, "");
  return `${base}${path}`;
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").replace(/</g, "&lt;");

/** Works out what publishing writes, how risky it is, and the pull request that carries it. */
export async function planPublish(input: PlanInput): Promise<PublishPlan> {
  const { page, config } = input;
  const files = await siteFiles({ page, brand: input.brand, uiCss: input.uiCss, config, gate: input.gate, targets: input.targets, read: input.read });
  const before = parseSource(await input.read(sourceFile(config, page)));
  const after = parseSource(files.find((f) => f.kind === "source")!.content)!;

  // A version removed since the last publish leaves its HTML behind otherwise.
  const written = new Set(files.map((f) => f.path));
  const removed: string[] = [];
  for (const v of before ? [null, ...before.page.variants] : []) {
    const path = htmlFile(config, versionPath(before!.page, v));
    if (!written.has(path) && (await input.read(path)) !== null) removed.push(path);
  }

  const changes: FileChange[] = [];
  for (const f of files) {
    const current = await input.read(f.path);
    const status = current === null ? "added" : current === f.content ? "unchanged" : "changed";
    changes.push({ path: f.path, kind: f.kind, status, ...(f.kind === "page" && status === "changed" && { beyondCopy: beyondCopy(current!, f.content) }) });
  }
  for (const path of removed) changes.push({ path, kind: "page", status: "removed" });

  const classification = classify(before, after, changes, input.gate && { verdict: input.gate.verdict, warnings: warningsOf(input.gate) });
  const branch = branchFor(page);
  const previews = input.previewUrl ? [null, ...page.variants].map((v) => ({ name: v?.name ?? "General", path: versionPath(page, v), url: previewFor(input.previewUrl!, branch, versionPath(page, v)) })) : [];
  const title = `${before ? "Update" : "Publish"} landing page: ${page.title}`;

  return {
    branch,
    title,
    body: prBody({ page, config, gate: input.gate, classification, changes, previews, isNew: !before }),
    labels: [classification.risk === "content" ? LABELS.content : LABELS.review],
    files,
    removed,
    changes,
    classification,
    previews,
    unchanged: changes.every((c) => c.status === "unchanged"),
  };
}

function prBody(o: { page: Page; config: SiteConfig; gate: GateReport | null; classification: Classification; changes: FileChange[]; previews: PublishPlan["previews"]; isNew: boolean }): string {
  const { page, config, classification } = o;
  const live = (path: string) => `${config.origin.replace(/\/+$/, "")}${path}`;
  const versions = [null, ...page.variants];
  const lines = [
    `${o.isNew ? "Publishes" : "Updates"} **${cell(page.title)}** at [\`${versionPath(page, null)}\`](${live(versionPath(page, null))})${page.variants.length ? `, with ${page.variants.length === 1 ? "a version" : `${page.variants.length} versions`} for ${page.variants.map((v) => v.name).join(", ")}` : ""}.`,
    "",
    classification.risk === "content" ? "🟢 **Copy only.** This merges itself once the checks pass." : "🟡 **Needs a reviewer.**",
    ...classification.reasons.map((r) => `- ${r}`),
    "",
  ];
  if (o.previews.length) lines.push("**Preview:** " + o.previews.map((p) => `[${cell(p.name)}](${p.url})`).join(" · "), "");

  lines.push("### Versions", "", "| Version | URL | H1 | Call to action |", "|---|---|---|---|");
  for (const v of versions) {
    const hero = applyVariant(page, v).blocks.find((b) => b.type === "hero");
    const h1 = hero?.type === "hero" ? hero.heading : "";
    const cta = hero?.type === "hero" ? hero.primaryCta.label : "";
    lines.push(`| ${cell(v?.name ?? "General")} | \`${versionPath(page, v)}\` | ${cell(h1)} | ${cell(cta)} |`);
  }

  lines.push("", "### Checks", "", o.gate ? gateMarkdown(o.gate) : "_The checks haven't run on this version of the page._");

  const changed = o.changes.filter((c) => c.status !== "unchanged");
  lines.push("", "### Files", "", "| File | Change |", "|---|---|", ...changed.map((c) => `| \`${c.path}\` | ${c.status} |`));
  lines.push("", "<sub>Published from landing-page-harness. To change the page, edit it in the studio and publish again: that updates this pull request, and edits made to these files here are overwritten.</sub>");
  return lines.join("\n");
}
