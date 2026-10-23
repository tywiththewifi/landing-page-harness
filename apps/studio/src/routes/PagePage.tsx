import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import type { Brief } from "@lph/brief/schema";
import { baseValue, checkPage, renderPage, versionPath, writeText, type Page, type PageIssue } from "@lph/page/browser";
import type { Brand } from "@lph/tokens";
import uiCss from "@lph/ui/styles.css?raw";
import { api, DEMO } from "../api.ts";
import { LeadsPanel } from "../components/LeadsPanel.tsx";
import { PageChecks } from "../components/PageChecks.tsx";
import { PageEditor, type EditorApi } from "../components/PageEditor.tsx";
import { PagePreview } from "../components/PagePreview.tsx";
import { VersionsTable } from "../components/VersionsTable.tsx";
import styles from "./PagePage.module.scss";
import review from "./ReviewPage.module.scss";

type Tab = "edit" | "versions" | "leads";
type SaveState = "idle" | "saving" | "saved" | "error";

export function PagePage() {
  const { id } = useParams();
  const [page, setPage] = useState<Page | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("edit");
  const [variantId, setVariantId] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set(["hero"]));
  const [focus, setFocus] = useState<{ id: string; at: number } | null>(null);
  const [save, setSave] = useState<SaveState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const column = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    api.page(id).then(
      async (p) => {
        const b = await api.brief(p.briefId);
        setBrand(await api.brand(p.brandId));
        setBrief(b);
        setPage(p);
      },
      (e: Error) => setError(e.message),
    );
  }, [id]);

  // A ref in step with state, so edits apply without stale closures.
  const current = useRef<Page | null>(null);
  current.current = page;

  // Edits apply immediately and are saved after a short pause.
  const update = useCallback((fn: (draft: Page) => void) => {
    const prev = current.current;
    if (!prev) return;
    const next = structuredClone(prev);
    fn(next);
    current.current = next;
    setPage(next);
    setSave("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api.savePage(next).then(
        (saved) => {
          setSave("saved");
          setPage((cur) => (cur ? { ...cur, updatedAt: saved.updatedAt } : cur));
        },
        () => setSave("error"),
      );
    }, 600);
  }, []);

  const variant = page?.variants.find((v) => v.id === variantId) ?? null;

  const editor: EditorApi | null = useMemo(
    () =>
      page && brand
        ? {
            page,
            brand,
            variant,
            update,
            setText: (key, value) =>
              update((d) => {
                const v = d.variants.find((x) => x.id === variant?.id);
                if (!v) return void writeText(d, key, value);
                if (value === baseValue(d, key)) delete v.overrides[key];
                else v.overrides[key] = value;
              }),
            resetText: (key) => update((d) => void delete d.variants.find((x) => x.id === variant?.id)?.overrides[key]),
            toGeneral: () => setVariantId(null),
          }
        : null,
    [page, brand, variant, update],
  );

  // The same checks the API and the publish gate run, live as you type.
  const issues = useMemo(() => (page && brief && brand ? checkPage(page, brief, brand) : []), [page, brief, brand]);

  // The preview renders the published HTML in the browser; deferred so typing stays smooth.
  const deferred = useDeferredValue(page);
  const html = useMemo(
    () =>
      deferred && brand
        ? renderPage(deferred, brand, uiCss, { variant: variantId, noindex: true, formAction: DEMO ? undefined : `${location.origin}/api/forms/${deferred.id}` })
        : "",
    [deferred, brand, variantId],
  );

  /** Opens the field an issue is about, in the right version, and shows it in the preview. */
  const jump = (issue: PageIssue) => {
    setVariantId(issue.variant ?? null);
    if (issue.area === "leads") return setTab("leads");
    if (issue.area === "versions") return setTab("versions");
    setTab("edit");
    if (issue.area === "page") return;
    const area = issue.area;
    setOpen((o) => new Set(o).add(area));
    setTimeout(() => {
      const section = column.current?.querySelector<HTMLElement>(`#block-${area}`);
      section?.scrollIntoView({ behavior: "smooth", block: "start" });
      const field = issue.path ? column.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(issue.path)}"] input, [data-key="${CSS.escape(issue.path)}"] textarea`) : null;
      field?.focus({ preventScroll: true });
      if (area !== "seo") setFocus({ id: area, at: Date.now() });
    }, 60);
  };

  // The publish screen links an issue here (?issue=<id>): open its field once the page is loaded.
  const [params, setParams] = useSearchParams();
  const wanted = params.get("issue");
  useEffect(() => {
    if (!wanted || !page) return;
    const issue = issues.find((i) => i.id === wanted);
    setParams({}, { replace: true });
    if (issue) jump(issue);
    // jump only reads state setters and refs.
  }, [wanted, page, issues]);

  if (error) {
    return (
      <div className={review.state}>
        <p>{error}</p>
        <Link to="/">Start again</Link>
      </div>
    );
  }
  if (!page || !brief || !brand || !editor) return <div className={review.state}>Loading page…</div>;

  const errors = issues.filter((i) => i.severity === "error").length;
  const versionIssues = issues.filter((i) => i.variant && i.severity !== "info").length;

  return (
    <div className={`${review.page} ${styles.page}`}>
      <div className={review.head}>
        <div>
          <h1>Build the page</h1>
          <p>Write the copy inside {brand.name}'s components. Layout, colour and type come from the brand, so the page can't drift off it.</p>
        </div>
        <div className={review.actions}>
          <span className={review.save} aria-live="polite">
            {{ idle: "", saving: "Saving…", saved: "All changes saved", error: "Couldn't save. Retrying on next edit." }[save]}
          </span>
          <Link className="ui-button" to={`/briefs/${brief.id}`}>
            Brief
          </Link>
          {DEMO ? null : (
            <a className="ui-button" href={`/api/pages/${page.id}/page.html${variant ? `?version=${variant.slug}` : ""}`} target="_blank" rel="noreferrer">
              Open preview
            </a>
          )}
          <Link className="ui-button ui-button--primary" to={`/pages/${page.id}/publish`} title={errors ? "The checks will block publishing until the issues marked Must fix are fixed" : undefined}>
            Publish
          </Link>
        </div>
      </div>

      <div className={review.card}>
        <div className={review.cardHead}>
          <div className={review.identity}>
            <strong>{page.title}</strong>
            <Link to={`/brands/${brand.id}`}>{brand.name}</Link>
          </div>
          <div className={styles.headControls}>
            <label className={styles.version}>
              <span>Version</span>
              <select className="ui-input" value={variantId ?? ""} onChange={(e) => setVariantId(e.target.value || null)}>
                <option value="">General · {versionPath(page, null)}</option>
                {page.variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} · {versionPath(page, v)}
                  </option>
                ))}
              </select>
            </label>
            <div className={review.tabs} role="tablist">
              {(
                [
                  ["edit", "Edit"],
                  ["versions", `Versions (${page.variants.length + 1})`],
                  ["leads", "Leads"],
                ] as const
              ).map(([key, label]) => (
                <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? review.tabOn : undefined} onClick={() => setTab(key)}>
                  {label}
                  {key === "edit" && errors ? <span className={review.badge}>{errors}</span> : null}
                  {key === "versions" && versionIssues ? <span className={review.badge}>{versionIssues}</span> : null}
                  {key === "leads" && issues.some((i) => i.area === "leads" && i.severity !== "info") ? <span className={review.badge}>!</span> : null}
                </button>
              ))}
            </div>
          </div>
        </div>

        {tab === "edit" ? (
          <div className={styles.layout}>
            <div className={styles.column} ref={column}>
              <PageChecks page={page} issues={issues} onJump={jump} />
              <PageEditor api={editor} issues={issues} open={open} setOpen={setOpen} />
            </div>
            <PagePreview html={html} title={`${page.title} preview`} focus={focus} path={versionPath(page, variant)} />
          </div>
        ) : null}
        {tab === "versions" ? (
          <VersionsTable
            page={page}
            brief={brief}
            issues={issues}
            update={update}
            onEdit={(v) => {
              setVariantId(v);
              setTab("edit");
            }}
          />
        ) : null}
        {tab === "leads" ? <LeadsPanel page={page} update={update} /> : null}
      </div>
    </div>
  );
}
