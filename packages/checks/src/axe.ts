import type { GateIssue, Severity } from "./types.ts";

/** The slice of axe-core's results the gate reads, so this file needs no axe types at runtime. */
export interface AxeRule {
  id: string;
  impact?: "minor" | "moderate" | "serious" | "critical" | null;
  tags: string[];
  help: string;
  helpUrl: string;
  nodes: { target: unknown[]; html?: string }[];
}
export interface AxeOutcome {
  violations: AxeRule[];
  incomplete: AxeRule[];
}

const WCAG = /^wcag2(1|2)?a{1,2}$/;

/** WCAG 2.2 A and AA, plus axe's best practices (landmarks, one H1, heading order). */
export const AXE_OPTIONS = {
  runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
  resultTypes: ["violations", "incomplete"],
} as const;

/**
 * WCAG failures that are serious or critical block publishing; the rest of WCAG and
 * serious best-practice problems need a reviewer. Results axe can't decide (text over
 * an image, say) are listed for a person to check.
 */
function severityOf(rule: AxeRule): Severity {
  const wcag = rule.tags.some((t) => WCAG.test(t));
  const serious = rule.impact === "serious" || rule.impact === "critical";
  if (wcag) return serious ? "error" : "warning";
  return serious ? "warning" : "info";
}

const target = (t: unknown[]) => t.map((x) => (Array.isArray(x) ? x.join(" ") : String(x))).join(" > ");

export function axeIssues(outcome: AxeOutcome, path: string): GateIssue[] {
  const issue = (rule: AxeRule, severity: Severity, suffix = ""): GateIssue => ({
    id: `a11y.${rule.id}`,
    check: "a11y",
    severity,
    message: `${rule.help}${suffix} (${rule.nodes.length === 1 ? "1 element" : `${rule.nodes.length} elements`}).`,
    path,
    help: rule.helpUrl,
    nodes: rule.nodes.slice(0, 5).map((n) => target(n.target)),
  });
  return [
    ...outcome.violations.map((r) => issue(r, severityOf(r))),
    ...outcome.incomplete.filter((r) => r.nodes.length).map((r) => issue(r, "info", ": needs a person to check")),
  ];
}
