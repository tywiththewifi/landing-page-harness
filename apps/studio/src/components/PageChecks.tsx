import { useState } from "react";
import type { Page, PageIssue } from "@lph/page/browser";
import styles from "./PageChecks.module.scss";

const SEVERITY: [PageIssue["severity"], string][] = [
  ["error", "Must fix before publishing"],
  ["warning", "Needs a reviewer's eye"],
  ["info", "Worth a look"],
];

/** The page's checks, collapsed to a verdict until opened. Each issue jumps to its field. */
export function PageChecks({ page, issues, onJump }: { page: Page; issues: PageIssue[]; onJump: (issue: PageIssue) => void }) {
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const [open, setOpen] = useState(errors > 0);
  const versionName = (id?: string) => page.variants.find((v) => v.id === id)?.name;
  return (
    <div className={styles.checks}>
      <button
        type="button"
        className={`${styles.verdict} ${errors ? styles.bad : warnings ? styles.warn : styles.ok}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <strong>{errors ? `${errors} to fix before publishing` : warnings ? `Ready to publish after review: ${warnings} to look at` : "Ready to publish"}</strong>
        <span>{open ? "Hide" : "Show"} checks</span>
      </button>
      {open
        ? SEVERITY.map(([sev, title]) => {
            const list = issues.filter((i) => i.severity === sev);
            if (!list.length) return null;
            return (
              <div key={sev} className={styles.group}>
                <h3>
                  {title} <span>{list.length}</span>
                </h3>
                <ul>
                  {list.map((i) => (
                    <li key={i.id}>
                      <button type="button" className={styles[`issue-${sev}`]} onClick={() => onJump(i)}>
                        {i.variant ? <span className={styles.version}>{versionName(i.variant) ?? i.variant}</span> : null}
                        {i.message}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        : null}
    </div>
  );
}
