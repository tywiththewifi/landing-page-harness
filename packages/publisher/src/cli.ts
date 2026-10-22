#!/usr/bin/env node
// lph-site: the checks a site repo's CI runs on a pull request from the publisher.
//
//   lph-site check --repo <dir> --base origin/main [--offline]
//       Runs the gate on every page the pull request changes (SEO and answer engines,
//       brand, accessibility, performance), decides the risk from the diff, and writes
//       risk= and verdict= to $GITHUB_OUTPUT. Exits 1 when a page is blocked.
//   lph-site classify --repo <dir> --base origin/main
//       The risk decision alone, without a browser.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { gateMarkdown, runGate, serverRunner, type GateReport } from "@lph/checks";
import { versionPath } from "@lph/page";
import { classify, LABELS, type Classification, type FileChange } from "./classify.ts";
import { DEFAULT_SITE, htmlFile, parseSource, type PageSource, type SiteConfig } from "./site.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { repo: { type: "string", default: "." }, base: { type: "string", default: "origin/main" }, offline: { type: "boolean", default: false } },
});
const command = positionals[0];
const repo = resolve(values.repo!);
const base = values.base!;

const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const atBase = (path: string): string | null => {
  try {
    return git("show", `${base}:${path}`);
  } catch {
    return null;
  }
};
const atHead = (path: string): string | null => (existsSync(join(repo, path)) ? readFileSync(join(repo, path), "utf8") : null);

const config: Omit<SiteConfig, "origin"> = { ...DEFAULT_SITE, ...(atHead("lph.json") ? JSON.parse(atHead("lph.json")!) : {}) };

function changedFiles(): { path: string; status: FileChange["status"] }[] {
  const out = git("diff", "--name-status", "--no-renames", `${base}...HEAD`).trim();
  if (!out) return [];
  return out.split("\n").map((line) => {
    const [code, path] = line.split("\t") as [string, string];
    return { path, status: code === "A" ? "added" : code === "D" ? "removed" : "changed" };
  });
}

interface PageChange {
  path: string;
  before: PageSource | null;
  after: PageSource | null;
  html: string[];
}

/** Groups the diff by page: each changed page source with the HTML files that belong to it. Anything else is "other". */
function pagesInDiff() {
  const files = changedFiles();
  const pages: PageChange[] = [];
  const claimed = new Set<string>();
  for (const f of files.filter((f) => f.path.startsWith(`${config.sourceDir}/`) && f.path.endsWith(".json"))) {
    const before = parseSource(atBase(f.path));
    const after = parseSource(atHead(f.path));
    const html = [before, after].flatMap((s) => (s ? [null, ...s.page.variants].map((v) => htmlFile(config, versionPath(s.page, v))) : []));
    claimed.add(f.path);
    html.forEach((p) => claimed.add(p));
    pages.push({ path: f.path, before, after, html: [...new Set(html)] });
  }
  const changes: FileChange[] = files.map((f) => ({
    path: f.path,
    status: f.status,
    kind: f.path.startsWith(`${config.sourceDir}/`) ? "source" : claimed.has(f.path) ? "page" : f.path.startsWith(config.functionsDir ? `${config.functionsDir}/` : "\u0000") || f.path.endsWith("_headers") ? "config" : "other",
  }));
  return { pages, changes };
}

function decide(pages: PageChange[], changes: FileChange[], verdicts: Map<string, GateReport["verdict"]>): Classification {
  if (!pages.length) return { risk: "review", reasons: ["No landing page changed: this isn't a publish from the studio."] };
  const reasons: string[] = [];
  for (const p of pages) {
    if (!p.after) {
      reasons.push(`${p.path} was removed or isn't a page source.`);
      continue;
    }
    // Each page is judged on its own files, plus every file that belongs to no page.
    const own = changes.filter((c) => p.html.includes(c.path) || c.path === p.path || (c.kind !== "page" && c.kind !== "source"));
    const studio = p.after.gate?.verdict ?? null;
    const ci = verdicts.get(p.path) ?? null;
    if (!studio) reasons.push(`${p.path}: published without the studio's checks.`);
    const worst = [studio, ci].includes("blocked") ? "blocked" : [studio, ci].includes("review") ? "review" : "ready";
    const c = classify(p.before, p.after, own, worst);
    if (c.risk === "review") reasons.push(...c.reasons.map((r) => (pages.length > 1 ? `/${p.after!.page.slug}: ${r}` : r)));
  }
  const loose = changes.filter((c) => c.kind === "other");
  if (loose.length) reasons.push(`Files outside the landing pages change: ${loose.map((c) => c.path).join(", ")}.`);
  return reasons.length ? { risk: "review", reasons: [...new Set(reasons)] } : { risk: "content", reasons: ["Copy only, on pages that are already live."] };
}

function output(values: Record<string, string>, summary: string) {
  console.log(summary);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([k, v]) => `${k}=${v}\n`).join(""));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}

const riskText = (c: Classification) =>
  c.risk === "content" ? `🟢 **Copy only** (\`${LABELS.content}\`): can merge itself once the checks pass.` : `🟡 **Needs a reviewer** (\`${LABELS.review}\`):\n${c.reasons.map((r) => `- ${r}`).join("\n")}`;

async function main() {
  if (command !== "check" && command !== "classify") {
    console.error("Usage: lph-site check|classify --repo <dir> --base <ref> [--offline]");
    process.exit(2);
  }
  const { pages, changes } = pagesInDiff();
  const verdicts = new Map<string, GateReport["verdict"]>();
  const sections: string[] = [];

  if (command === "check") {
    const runner = await serverRunner({ offline: values.offline });
    try {
      for (const p of pages) {
        if (!p.after) continue;
        const page = p.after.page;
        const versions = [null, ...page.variants].map((v) => {
          const path = versionPath(page, v);
          return { slug: v?.slug ?? null, name: v?.name ?? "General", path, html: atHead(htmlFile(config, path)) ?? "" };
        });
        const missing = versions.filter((v) => !v.html);
        if (missing.length) {
          verdicts.set(p.path, "blocked");
          sections.push(`### /${page.slug}\n\n❌ Missing HTML for ${missing.map((v) => v.path).join(", ")}.`);
          continue;
        }
        const report = await runGate({ versions, targets: p.after.targets }, runner);
        verdicts.set(p.path, report.verdict);
        sections.push(`### /${page.slug}\n\n${gateMarkdown(report)}`);
      }
    } finally {
      await runner.close();
    }
  }

  const decision = decide(pages, changes, verdicts);
  const verdict = [...verdicts.values()].includes("blocked") ? "blocked" : [...verdicts.values()].includes("review") ? "review" : "ready";
  output({ risk: decision.risk, ...(command === "check" && { verdict }) }, ["## Landing pages", "", riskText(decision), "", ...sections].join("\n"));
  if (verdict === "blocked") process.exit(1);
}

await main();
