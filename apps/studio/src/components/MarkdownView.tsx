import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useState, type ReactNode } from "react";
import { DEMO } from "../api.ts";
import styles from "./MarkdownView.module.scss";

/**
 * A generated Markdown file, rendered or raw, with copy and open links. Read-only:
 * the file is generated from the editor, so the two can't drift apart.
 */
export function MarkdownView({ load, version, rawHref, notice }: { load: () => Promise<string>; version: string; rawHref: string; notice: ReactNode }) {
  const [md, setMd] = useState<string | null>(null);
  const [raw, setRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    load().then(setMd, () => setMd("Couldn't load the file."));
    // `load` is recreated each render; the version says when the content changed.
  }, [rawHref, version]);

  async function copy() {
    if (!md) return;
    try {
      await navigator.clipboard.writeText(md);
    } catch {
      // Clipboard access can be blocked (for example inside a frame); show the text to copy by hand.
      setRaw(true);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.notice}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M8 7v4M8 5v.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        {notice}
      </div>
      <div className={styles.toolbar}>
        <div className={styles.toggle} role="group" aria-label="View">
          <button aria-pressed={!raw} onClick={() => setRaw(false)}>
            Rendered
          </button>
          <button aria-pressed={raw} onClick={() => setRaw(true)}>
            Markdown
          </button>
        </div>
        <div className={styles.links}>
          {DEMO ? null : (
            <a href={rawHref} target="_blank" rel="noreferrer">
              Open raw
            </a>
          )}
          <button className="ui-button ui-button--small" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      {md === null ? (
        <p className={styles.loading}>Generating…</p>
      ) : raw ? (
        <pre className={styles.raw}>{md}</pre>
      ) : (
        // The file includes text taken from the site and from people's edits, so sanitise the HTML.
        <article className={styles.doc} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(md, { async: false })) }} />
      )}
    </div>
  );
}
