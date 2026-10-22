export type CheckId = "content" | "brand" | "seo" | "a11y" | "performance";
export type Severity = "error" | "warning" | "info";

export interface GateIssue {
  /** Stable within a check, e.g. "seo.canonical" or "a11y.color-contrast". */
  id: string;
  check: CheckId;
  /** error: blocks publishing. warning: a reviewer has to look. info: worth a look. */
  severity: Severity;
  message: string;
  /** The version's URL path ("/hubspot/revops"), when the issue is on one version only. */
  path?: string;
  /** For content issues: where the editor should jump (see PageIssue). */
  area?: string;
  variant?: string;
  field?: string;
  /** A page explaining the rule (axe's help pages). */
  help?: string;
  /** Where on the page: CSS selectors or short HTML snippets. */
  nodes?: string[];
}

export interface CheckResult {
  id: CheckId;
  title: string;
  status: "pass" | "warn" | "fail" | "skipped";
  /** One line for the report: what was checked, or why it was skipped. */
  summary: string;
  issues: GateIssue[];
}

export interface PerfSample {
  path: string;
  htmlBytes: number;
  htmlGzipBytes: number;
  /** Requests the page makes besides the HTML: stylesheets, fonts, scripts, images. */
  requests: number;
  /** Everything transferred, HTML included. Measured in a browser; estimated from the HTML otherwise. */
  transferBytes: number | null;
  /** Requests in <head> that hold up the first paint. */
  renderBlocking: number;
  domNodes: number;
  /** Lab metrics from a real browser at phone size with a 4× CPU slowdown. Null when not measured. */
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
}

export interface GateVersion {
  /** The persona version's slug, or null for the general page. */
  slug: string | null;
  name: string;
  path: string;
}

export interface GateReport {
  pageId: string;
  /** The page edit the report is for. A later edit makes it stale. */
  pageUpdatedAt: string;
  ranAt: string;
  /** "server" runs every check in a real browser; "browser" is the studio demo, without lab timings. */
  environment: "server" | "browser";
  /** blocked: an error. review: a warning, so a person has to approve. ready: nothing to fix. */
  verdict: "blocked" | "review" | "ready";
  checks: CheckResult[];
  versions: GateVersion[];
  performance: PerfSample[];
  budget: Budget;
}

/** Limits for the performance check. Over `warn` needs a reviewer; over `fail` blocks. */
export interface Budget {
  htmlGzipKb: { warn: number; fail: number };
  transferKb: { warn: number; fail: number };
  requests: { warn: number; fail: number };
  renderBlocking: { warn: number; fail: number };
  domNodes: { warn: number; fail: number };
  lcpMs: { warn: number; fail: number };
  cls: { warn: number; fail: number };
  tbtMs: { warn: number; fail: number };
}

/**
 * Landing pages are one screen of copy and a form, so the budget is tighter than a
 * general site's: Lighthouse's "good" thresholds for timings, and sizes a page built
 * from tokens and a few components stays well inside.
 */
export const DEFAULT_BUDGET: Budget = {
  htmlGzipKb: { warn: 30, fail: 100 },
  transferKb: { warn: 400, fail: 1000 },
  requests: { warn: 15, fail: 40 },
  renderBlocking: { warn: 2, fail: 5 },
  domNodes: { warn: 800, fail: 1400 },
  lcpMs: { warn: 2500, fail: 4000 },
  cls: { warn: 0.1, fail: 0.25 },
  tbtMs: { warn: 200, fail: 600 },
};

export const CHECK_TITLES: Record<CheckId, string> = {
  content: "Content",
  brand: "Brand",
  seo: "SEO and answer engines",
  a11y: "Accessibility",
  performance: "Performance",
};

export function statusOf(issues: GateIssue[]): CheckResult["status"] {
  if (issues.some((i) => i.severity === "error")) return "fail";
  if (issues.some((i) => i.severity === "warning")) return "warn";
  return "pass";
}

export function verdictOf(checks: CheckResult[]): GateReport["verdict"] {
  if (checks.some((c) => c.status === "fail")) return "blocked";
  if (checks.some((c) => c.status === "warn")) return "review";
  return "ready";
}

export const count = (issues: GateIssue[], severity: Severity) => issues.filter((i) => i.severity === severity).length;
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
