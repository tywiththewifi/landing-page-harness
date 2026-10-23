#!/usr/bin/env -S npx tsx
/**
 * lph-try <url> [--prompt "..."] [--product <url>] [--no-gate] [--out <dir>]
 *
 * Runs a site through every phase (brand import, brief, page, publish checks) and writes
 * what came out of each to a folder, with report.md on top. Several URLs run one after another.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { connectApi } from "./local.ts";
import { reportMarkdown, runFromUrl, type RunReport } from "./pipeline.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    prompt: { type: "string" },
    product: { type: "string" },
    "no-gate": { type: "boolean" },
    out: { type: "string" },
  },
});

if (!positionals.length) {
  console.error('Usage: pnpm try <url> [more urls] [--prompt "..."] [--product <url>] [--no-gate] [--out <dir>]');
  process.exit(1);
}

const { api, summary, close } = await connectApi();
for (const line of summary) console.error(line);

const outRoot = resolve(values.out ?? "runs");
const reports: RunReport[] = [];
for (const raw of positionals) {
  const url = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
  console.error(`\n${url}`);
  const report = await runFromUrl(api, { url, prompt: values.prompt, productUrl: values.product, gate: !values["no-gate"] }, (step) => console.error(`• ${step}`));
  reports.push(report);

  const dir = join(outRoot, `${new URL(url).hostname.replace(/^www\./, "")}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "report.md"), reportMarkdown(report));
  await writeFile(join(dir, "report.json"), JSON.stringify(report, null, 2));
  // Save what each link points at, so the folder stands on its own after the API stops.
  const files: Record<string, string> = { brandPreview: "brand-preview.html", designMd: "DESIGN.md", tokensCss: "tokens.css", briefMd: "brief.md", page: "page.html" };
  for (const [key, link] of Object.entries(report.links)) {
    const name = files[key] ?? (key.startsWith("page:") ? `page-${key.slice(5)}.html` : null);
    if (!name) continue;
    const res = await fetch(link).catch(() => null);
    if (res?.ok) await writeFile(join(dir, name), await res.text());
  }
  console.error(report.stopped ? `✗ Stopped at ${report.stopped.stage}: ${report.stopped.reason}` : `✓ ${report.gate ? `Gate: ${report.gate.verdict}` : `Reached ${report.reached}`}`);
  console.error(`  ${dir}/report.md`);
}

if (reports.length > 1) {
  console.error("\n| Site | Reached | Gate | Time |\n|---|---|---|---|");
  for (const r of reports) console.error(`| ${r.brand?.name ?? r.url} | ${r.stopped ? `stopped at ${r.stopped.stage}` : r.reached} | ${r.gate?.verdict ?? "–"} | ${Object.values(r.seconds).reduce((a, b) => a + (b ?? 0), 0).toFixed(0)}s |`);
}
await close();
