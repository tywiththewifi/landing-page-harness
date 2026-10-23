import { count, plural, type GateIssue, type GateReport, type PerfSample } from "./types.ts";

const ICON = { pass: "✅", warn: "⚠️", fail: "❌", skipped: "➖" } as const;
const SEVERITY = { error: "❌", warning: "⚠️", info: "ℹ️" } as const;

export const VERDICT_TEXT: Record<GateReport["verdict"], string> = {
  blocked: "Blocked: fix the errors before publishing.",
  review: "Passed with warnings: nothing blocks publishing.",
  ready: "Ready: every check passed.",
};

/** Markdown can't break out of a table cell or a list item. */
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").replace(/</g, "&lt;");

const kb = (bytes: number | null) => (bytes === null ? "–" : `${(bytes / 1024).toFixed(1)} KB`);
const ms = (v: number | null) => (v === null ? "–" : `${(v / 1000).toFixed(2)} s`);

function issueLine(i: GateIssue): string {
  const where = i.path ? ` \`${i.path}\`` : "";
  const help = i.help ? ` ([why](${i.help}))` : "";
  return `- ${SEVERITY[i.severity]}${where} ${cell(i.message)}${help}`;
}

export function perfTable(samples: PerfSample[]): string {
  return [
    "| Version | HTML (gzip) | Transferred | Requests | Blocking | Elements | LCP | CLS | TBT |",
    "|---|---|---|---|---|---|---|---|---|",
    ...samples.map(
      (s) =>
        `| \`${s.path}\` | ${kb(s.htmlGzipBytes)} | ${kb(s.transferBytes)} | ${s.requests} | ${s.renderBlocking} | ${s.domNodes} | ${ms(s.lcpMs)} | ${s.cls === null ? "–" : s.cls.toFixed(2)} | ${s.tbtMs === null ? "–" : `${Math.round(s.tbtMs)} ms`} |`,
    ),
  ].join("\n");
}

/** The gate report as Markdown, for a pull request body or a CI job summary. */
export function gateMarkdown(report: GateReport, opts: { notes?: boolean } = {}): string {
  const lines = [
    `**${ICON[report.verdict === "ready" ? "pass" : report.verdict === "review" ? "warn" : "fail"]} ${VERDICT_TEXT[report.verdict]}**`,
    "",
    "| Check | Result |",
    "|---|---|",
    ...report.checks.map((c) => `| ${ICON[c.status]} ${c.title} | ${cell(c.summary)} |`),
  ];
  const shown = report.checks.flatMap((c) => c.issues.filter((i) => i.severity !== "info" || opts.notes));
  if (shown.length) {
    for (const c of report.checks) {
      const list = c.issues.filter((i) => i.severity !== "info" || opts.notes);
      if (!list.length) continue;
      lines.push("", `<details${count(list, "error") ? " open" : ""}><summary>${c.title}: ${plural(list.length, "issue")}</summary>`, "", ...list.map(issueLine), "", "</details>");
    }
  }
  lines.push("", "<details><summary>Performance by version</summary>", "", perfTable(report.performance), "", "</details>");
  if (report.environment === "browser") lines.push("", "_Checked in the browser: lab timings run when the server publishes._");
  return lines.join("\n");
}
