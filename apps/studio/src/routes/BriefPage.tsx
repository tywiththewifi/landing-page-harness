import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { checkBrief } from "@lph/brief/check";
import type { Brief } from "@lph/brief/schema";
import type { Brand } from "@lph/tokens";
import { api, waitForJob, type PageSummary } from "../api.ts";
import { BriefEditor } from "../components/BriefEditor.tsx";
import { MarkdownView } from "../components/MarkdownView.tsx";
import styles from "./ReviewPage.module.scss";

type Tab = "brief" | "markdown";
type SaveState = "idle" | "saving" | "saved" | "error";

export function BriefPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [brief, setBrief] = useState<Brief | null>(null);
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [building, setBuilding] = useState<string | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("brief");
  const [save, setSave] = useState<SaveState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!id) return;
    api.brief(id).then(
      async (b) => {
        setBrief(b);
        setBrand(await api.brand(b.brandId));
      },
      (e: Error) => setError(e.message),
    );
    api.listPages(id).then(setPages, () => {});
  }, [id]);

  // Keep a ref in step with state so edits can be applied without stale closures.
  const current = useRef<Brief | null>(null);
  current.current = brief;

  // Edits apply immediately and are saved after a short pause.
  const update = useCallback((fn: (draft: Brief) => void) => {
    const prev = current.current;
    if (!prev) return;
    const next = structuredClone(prev);
    fn(next);
    current.current = next;
    setBrief(next);
    setSave("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api.saveBrief(next).then(
        (saved) => {
          setSave("saved");
          setBrief((cur) => (cur ? { ...cur, updatedAt: saved.updatedAt } : cur));
        },
        () => setSave("error"),
      );
    }, 600);
  }, []);

  // The same checks the API runs, live as you type.
  const issues = useMemo(() => (brief && brand ? checkBrief(brief, brand) : []), [brief, brand]);

  if (error) {
    return (
      <div className={styles.state}>
        <p>{error}</p>
        <Link to="/">Start again</Link>
      </div>
    );
  }
  if (!brief || !brand) return <div className={styles.state}>Loading brief…</div>;

  const errors = issues.filter((i) => i.severity === "error").length;

  async function build() {
    setBuildError(null);
    try {
      setBuilding("Starting");
      const done = await waitForJob(await api.createPage(brief!.id), setBuilding);
      navigate(`/pages/${done.pageId}`);
    } catch (err) {
      setBuildError((err as Error).message);
      setBuilding(null);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <h1>Review the brief</h1>
          <p>Edit anything. The checks on the right update as you go, and the page is built from this in the next step.</p>
        </div>
        <div className={styles.actions}>
          <span className={styles.save} aria-live="polite">
            {{ idle: "", saving: "Saving…", saved: "All changes saved", error: "Couldn't save. Retrying on next edit." }[save]}
          </span>
          <Link className="ui-button" to={`/brands/${brand.id}/briefs/new`}>
            New brief
          </Link>
          {pages[0] ? (
            <Link className="ui-button" to={`/pages/${pages[0].id}`}>
              Open the page
            </Link>
          ) : null}
          <button
            className="ui-button ui-button--primary"
            disabled={!!errors || !!building || save === "saving"}
            title={errors ? "Fix the issues marked Must fix first" : undefined}
            onClick={() => void build()}
          >
            {building ? `${building}…` : pages.length ? "Build it again" : "Build the page"}
          </button>
        </div>
      </div>

      {buildError ? (
        <p className={styles.error} role="alert">
          {buildError}
        </p>
      ) : null}
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <div className={styles.identity}>
            <strong>{brief.title}</strong>
            <Link to={`/brands/${brand.id}`}>{brand.name}</Link>
          </div>
          <div className={styles.tabs} role="tablist">
            {(
              [
                ["brief", "Brief"],
                ["markdown", "Brief.md"],
              ] as const
            ).map(([key, label]) => (
              <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? styles.tabOn : undefined} onClick={() => setTab(key)}>
                {label}
                {key === "brief" && errors ? <span className={styles.badge}>{errors}</span> : null}
              </button>
            ))}
          </div>
        </div>
        <p className={styles.request}>
          <span className="ui-label">Your request</span>
          {brief.prompt}
        </p>
        {tab === "brief" ? <BriefEditor brief={brief} issues={issues} update={update} /> : null}
        {tab === "markdown" ? (
          <MarkdownView
            load={() => api.briefMd(brief.id)}
            version={brief.updatedAt}
            rawHref={`/api/briefs/${brief.id}/brief.md`}
            notice="Edit the brief in the Brief tab. This is the version to share, and what agents read before building the page."
          />
        ) : null}
      </div>
    </div>
  );
}
