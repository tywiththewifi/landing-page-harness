import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useState } from "react";
import type { Brand } from "@lph/tokens";
import { api } from "../api.ts";
import styles from "./DesignMdTab.module.scss";

/** Read-only by design: Design.md is generated from the Theme tab, so they can't drift apart. */
export function DesignMdTab({ brand }: { brand: Brand }) {
  const [md, setMd] = useState<string | null>(null);
  const [raw, setRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.designMd(brand.id).then(setMd, () => setMd("Couldn't load Design.md."));
  }, [brand.id, brand.updatedAt]);

  async function copy() {
    if (!md) return;
    await navigator.clipboard.writeText(md);
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
        Changes to your brand must be made in the Theme tab. This file is what agents read.
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
          <a href={`/api/brands/${brand.id}/design.md`} target="_blank" rel="noreferrer">
            Open raw
          </a>
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
        // Design.md includes text taken from the site (button labels, logo text), so sanitise the HTML.
        <article className={styles.doc} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(md, { async: false })) }} />
      )}
    </div>
  );
}
