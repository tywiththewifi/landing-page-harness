import { useState } from "react";
import { Link } from "react-router";
import { VERDICT_TEXT, type CheckResult, type GateIssue, type GateReport as Report, type PerfSample } from "@lph/checks/browser";
import styles from "./GateReport.module.scss";

const STATUS: Record<CheckResult["status"], string> = { pass: "Passed", warn: "Needs review", fail: "Failed", skipped: "Skipped" };
const SEVERITY: Record<GateIssue["severity"], string> = { error: "Must fix", warning: "Review", info: "Note" };

const kb = (bytes: number | null) => (bytes === null ? "–" : `${(bytes / 1024).toFixed(1)} KB`);
const seconds = (ms: number | null) => (ms === null ? "–" : `${(ms / 1000).toFixed(2)} s`);

type Limit = { warn: number; fail: number };

/** Each measure as a row, with its budget, so the table stays narrow however long the URLs are. */
function Performance({ report }: { report: Report }) {
  const b = report.budget;
  const rows: { label: string; limit: Limit; budget: string; value: (s: PerfSample) => number | null; text: (s: PerfSample) => string }[] = [
    { label: "HTML (gzip)", limit: b.htmlGzipKb, budget: `${b.htmlGzipKb.warn} KB`, value: (s) => s.htmlGzipBytes / 1024, text: (s) => kb(s.htmlGzipBytes) },
    { label: "Transferred", limit: b.transferKb, budget: `${b.transferKb.warn} KB`, value: (s) => (s.transferBytes === null ? null : s.transferBytes / 1024), text: (s) => kb(s.transferBytes) },
    { label: "Requests", limit: b.requests, budget: `${b.requests.warn}`, value: (s) => s.requests, text: (s) => `${s.requests}` },
    { label: "Render-blocking", limit: b.renderBlocking, budget: `${b.renderBlocking.warn}`, value: (s) => s.renderBlocking, text: (s) => `${s.renderBlocking}` },
    { label: "Elements", limit: b.domNodes, budget: `${b.domNodes.warn}`, value: (s) => s.domNodes, text: (s) => `${s.domNodes}` },
    { label: "LCP", limit: b.lcpMs, budget: seconds(b.lcpMs.warn), value: (s) => s.lcpMs, text: (s) => seconds(s.lcpMs) },
    { label: "CLS", limit: b.cls, budget: `${b.cls.warn}`, value: (s) => s.cls, text: (s) => (s.cls === null ? "–" : s.cls.toFixed(2)) },
    { label: "TBT", limit: b.tbtMs, budget: `${b.tbtMs.warn} ms`, value: (s) => s.tbtMs, text: (s) => (s.tbtMs === null ? "–" : `${Math.round(s.tbtMs)} ms`) },
  ];
  const level = (value: number | null, { warn, fail }: Limit) => (value === null ? undefined : value > fail ? styles.over : value > warn ? styles.near : undefined);
  const nameOf = (path: string) => report.versions.find((v) => v.path === path)?.name ?? path;
  return (
    <div className={styles.perf}>
      <table>
        <caption className="ui-visually-hidden">Performance by version, against the budget</caption>
        <thead>
          <tr>
            <th scope="col">Performance</th>
            <th scope="col">Budget</th>
            {report.performance.map((s) => (
              <th scope="col" key={s.path} title={s.path}>
                {nameOf(s.path)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              <td className={styles.budget}>{r.budget}</td>
              {report.performance.map((s) => (
                <td key={s.path} className={level(r.value(s), r.limit)}>
                  {r.text(s)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        {report.environment === "server"
          ? "Timings are measured in Chromium at phone size with a 4× CPU slowdown. Over the budget is a warning; far over it is an error."
          : "Timings are measured when the server runs the checks. Over the budget is a warning; far over it is an error."}
      </p>
    </div>
  );
}

/** The gate's report: the verdict, each check with its issues, and performance by version. */
export function GateReport({ report, pageId, stale }: { report: Report; pageId: string; stale: boolean }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(report.checks.filter((c) => c.status === "fail").map((c) => c.id)));
  const toggle = (id: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const tone = report.verdict === "ready" ? styles.ok : report.verdict === "review" ? styles.warn : styles.bad;

  return (
    <div className={styles.report}>
      <div className={`${styles.verdict} ${stale ? styles.stale : tone}`} role="status">
        <strong>{stale ? "The page changed since these checks ran. Run them again before publishing." : VERDICT_TEXT[report.verdict]}</strong>
        <span>
          Checked {new Date(report.ranAt).toLocaleString()} {report.environment === "browser" ? "in this browser" : "on the server"}, {report.versions.length} version
          {report.versions.length === 1 ? "" : "s"}
        </span>
      </div>

      <ul className={styles.checks}>
        {report.checks.map((c) => {
          const shown = c.issues;
          const expanded = open.has(c.id);
          return (
            <li key={c.id} className={styles[`check-${c.status}`]}>
              <button type="button" className={styles.checkHead} aria-expanded={expanded} disabled={!shown.length} onClick={() => toggle(c.id)}>
                <span className={styles.status}>{STATUS[c.status]}</span>
                <strong>{c.title}</strong>
                <span className={styles.summary}>{c.summary}</span>
                {shown.length ? <span className={styles.more}>{expanded ? "Hide" : `Show ${shown.length}`}</span> : null}
              </button>
              {expanded ? (
                <ul className={styles.issues}>
                  {shown.map((i, n) => (
                    <li key={`${i.id}-${i.path ?? ""}-${n}`} className={styles[`issue-${i.severity}`]}>
                      <span className={styles.severity}>{SEVERITY[i.severity]}</span>
                      {i.path ? <code className={styles.path}>{i.path}</code> : null}
                      <span>{i.message}</span>
                      {i.nodes?.length ? <code className={styles.nodes}>{i.nodes.join(", ")}</code> : null}
                      <span className={styles.links}>
                        {i.help ? (
                          <a href={i.help} target="_blank" rel="noreferrer">
                            Why
                          </a>
                        ) : null}
                        {i.area ? <Link to={`/pages/${pageId}?issue=${encodeURIComponent(i.id)}`}>Fix in the editor</Link> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>

      <Performance report={report} />
    </div>
  );
}
