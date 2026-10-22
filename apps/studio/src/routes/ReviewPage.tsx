import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import type { Brand } from "@lph/tokens";
import { api, waitForJob } from "../api.ts";
import { ConfirmPanel } from "../components/ConfirmPanel.tsx";
import { DesignMdTab } from "../components/DesignMdTab.tsx";
import { PreviewTab } from "../components/PreviewTab.tsx";
import { Theme } from "../components/Theme.tsx";
import styles from "./ReviewPage.module.scss";

type Tab = "theme" | "design" | "preview";
type SaveState = "idle" | "saving" | "saved" | "error";

/** Loads the brand's own web fonts so type previews render in the real faces. */
function useBrandFonts(brand: Brand | null) {
  useEffect(() => {
    if (!brand) return;
    const nodes: HTMLElement[] = [];
    for (const href of brand.fontSources?.stylesheets ?? []) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      nodes.push(link);
    }
    if (brand.fontSources?.faces.length) {
      const style = document.createElement("style");
      style.textContent = brand.fontSources.faces.join("\n");
      nodes.push(style);
    }
    nodes.forEach((n) => document.head.appendChild(n));
    return () => nodes.forEach((n) => n.remove());
  }, [brand?.id, brand?.fontSources]);
}

export function ReviewPage() {
  const { id } = useParams();
  const [brand, setBrand] = useState<Brand | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("theme");
  const [save, setSave] = useState<SaveState>("idle");
  const [retrying, setRetrying] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{ dir: string; files: string[] } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useBrandFonts(brand);

  useEffect(() => {
    if (!id) return;
    api.brand(id).then(setBrand, (e: Error) => setError(e.message));
  }, [id]);

  // Keep a ref in step with state so edits can be applied without stale closures.
  const current = useRef<Brand | null>(null);
  current.current = brand;

  // Edits apply immediately and are saved after a short pause.
  const update = useCallback((fn: (draft: Brand) => void) => {
    const prev = current.current;
    if (!prev) return;
    const next = structuredClone(prev);
    fn(next);
    current.current = next;
    setBrand(next);
    setConfirmed(null);
    setSave("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api.save(next).then(
        (saved) => {
          setSave("saved");
          setBrand((cur) => (cur ? { ...cur, updatedAt: saved.updatedAt } : cur));
        },
        () => setSave("error"),
      );
    }, 600);
  }, []);

  const resolve = useCallback(
    async (conflictId: string, value: string) => {
      if (!brand) return;
      setBrand(await api.resolve(brand.id, conflictId, value));
      setConfirmed(null);
    },
    [brand],
  );

  async function retry() {
    if (!brand) return;
    try {
      setRetrying("Starting");
      await waitForJob(await api.retry(brand.id), setRetrying);
      setBrand(await api.brand(brand.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRetrying(null);
    }
  }

  async function confirm() {
    if (!brand) return;
    clearTimeout(timer.current);
    await api.save(brand);
    setConfirmed(await api.confirm(brand.id));
  }

  if (error) {
    return (
      <div className={styles.state}>
        <p>{error}</p>
        <Link to="/">Import another site</Link>
      </div>
    );
  }
  if (!brand) return <div className={styles.state}>Loading brand…</div>;

  const openConflicts = brand.conflicts.filter((c) => c.options.length > 1 && !c.reviewed).length;

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <h1>Review your brand</h1>
          <p>Check what we measured. Edit anything that's off; Design.md and the exports update with you.</p>
        </div>
        <div className={styles.actions}>
          <span className={styles.save} aria-live="polite">
            {retrying ?? { idle: "", saving: "Saving…", saved: "All changes saved", error: "Couldn't save. Retrying on next edit." }[save]}
          </span>
          <button className="ui-button" onClick={retry} disabled={!!retrying}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M12 7a5 5 0 11-1.5-3.6M12 1.5V4H9.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
            </svg>
            Try again
          </button>
          <button className="ui-button ui-button--primary" onClick={confirm} disabled={!!retrying}>
            Confirm
          </button>
        </div>
      </div>

      {confirmed ? <ConfirmPanel brand={brand} result={confirmed} onClose={() => setConfirmed(null)} /> : null}

      <div className={styles.card}>
        <div className={styles.cardHead}>
          <div className={styles.identity}>
            <strong>{brand.name}</strong>
            <a href={brand.url} target="_blank" rel="noreferrer">
              {new URL(brand.url).host}
            </a>
          </div>
          <div className={styles.tabs} role="tablist">
            {(
              [
                ["theme", "Theme"],
                ["design", "Design.md"],
                ["preview", "Preview"],
              ] as const
            ).map(([key, label]) => (
              <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? styles.tabOn : undefined} onClick={() => setTab(key)}>
                {label}
                {key === "theme" && openConflicts ? <span className={styles.badge}>{openConflicts}</span> : null}
              </button>
            ))}
          </div>
        </div>
        {tab === "theme" ? <Theme brand={brand} update={update} resolve={resolve} /> : null}
        {tab === "design" ? <DesignMdTab brand={brand} /> : null}
        {tab === "preview" ? <PreviewTab brand={brand} /> : null}
      </div>
    </div>
  );
}
