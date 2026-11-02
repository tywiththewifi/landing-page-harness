import { useState } from "react";
import type { Source } from "@lph/tokens";
import styles from "./Confidence.module.scss";

const label = (n: number) => (n >= 0.75 ? "High" : n >= 0.5 ? "Medium" : "Low");
const pagePath = (url: string) => {
  try {
    const u = new URL(url);
    return u.pathname === "/" ? "Home" : u.pathname;
  } catch {
    return url;
  }
};

/** Shows how sure the extractor is about a value, and where it saw it. */
export function Confidence({ value, sources }: { value: number; sources: Source[] }) {
  const [open, setOpen] = useState(false);
  const level = label(value);
  return (
    <span className={styles.wrap}>
      <button
        type="button"
        className={`${styles.pill} ${styles[level.toLowerCase()]}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={`How sure we are: ${level.toLowerCase()}. Click to see where we found it.`}
      >
        {level}
      </button>
      {open ? (
        <span className={styles.pop} role="dialog" aria-label="Where we found it">
          <strong>Found on</strong>
          {sources.length ? (
            sources.map((s) => (
              <span key={s.page + s.selector} className={styles.source} title={s.selector}>
                <span>
                  {pagePath(s.page)} · seen {s.count === 1 ? "once" : `${s.count} times`}
                </span>
              </span>
            ))
          ) : (
            <span className={styles.source}>You added this yourself</span>
          )}
        </span>
      ) : null}
    </span>
  );
}
