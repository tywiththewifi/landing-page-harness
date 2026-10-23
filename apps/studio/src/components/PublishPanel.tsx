import DOMPurify from "dompurify";
import { marked } from "marked";
import { useMemo, useState } from "react";
import type { PublishInfo, PublishResult } from "../api.ts";
import markdown from "./MarkdownView.module.scss";
import styles from "./PublishPanel.module.scss";

const STATUS: Record<string, string> = { added: "New", changed: "Changed", removed: "Removed", unchanged: "Same" };
const KIND: Record<string, string> = { page: "Page", source: "Source", config: "Site config", other: "Other" };

interface Props {
  info: PublishInfo;
  /** Why publishing isn't possible right now, if it isn't. */
  blocked: string | null;
  demo: boolean;
  busy: boolean;
  result: PublishResult | null;
  error: string | null;
  onPublish: () => void;
  onDownload: () => void;
}

/** Where the page goes, how risky the change is, and the pull request that carries it. */
export function PublishPanel({ info, blocked, demo, busy, result, error, onPublish, onDownload }: Props) {
  const { plan, target, published } = info;
  const [showBody, setShowBody] = useState(false);
  const [showSame, setShowSame] = useState(false);
  const body = useMemo(() => (showBody ? DOMPurify.sanitize(marked.parse(plan.body, { async: false })) : ""), [showBody, plan.body]);
  const changed = plan.changes.filter((c) => c.status !== "unchanged");
  const files = showSame ? plan.changes : changed;
  const content = plan.classification.risk === "content";

  return (
    <div className={styles.panel}>
      <div className={styles.target}>
        <div>
          <span className="ui-label">Destination</span>
          {target ? (
            <p>
              A pull request into <strong>{target.repo}</strong> ({target.base}), on <code>{plan.branch}</code>
              {target.reviewers.length ? <>, reviewed by {target.reviewers.join(", ")}</> : null}.
            </p>
          ) : demo ? (
            <p>In the demo nothing is pushed. This is the pull request the studio would open in the company's site repo, and the folder it would host on Cloudflare Pages.</p>
          ) : (
            <p>
              No site repo is connected. Set <code>LPH_GITHUB_REPO</code> and <code>LPH_GITHUB_TOKEN</code> on the server to publish as pull requests, or download the page for Cloudflare Pages.
            </p>
          )}
          <p className={styles.url}>
            Live at <code>{info.config.origin}{plan.previews[0]?.path ?? ""}</code>
            {published ? (
              <>
                {" "}
                · latest pull request{" "}
                <a href={published.url} target="_blank" rel="noreferrer">
                  #{published.number}
                </a>
              </>
            ) : null}
          </p>
        </div>
      </div>

      <div className={`${styles.risk} ${content ? styles.content : styles.review}`}>
        <strong>{content ? "Copy only: merges itself once the checks pass" : "Needs a reviewer"}</strong>
        <ul>
          {plan.classification.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
          {content ? <li>The site's CI checks the diff again before it merges.</li> : null}
        </ul>
        <span className={styles.label}>{plan.labels.join(", ")}</span>
      </div>

      <div className={styles.files}>
        <div className={styles.filesHead}>
          <span className="ui-label">
            Files {changed.length !== plan.changes.length ? `(${changed.length} of ${plan.changes.length} change)` : `(${plan.changes.length})`}
          </span>
          {changed.length !== plan.changes.length ? (
            <button type="button" className="ui-button ui-button--ghost ui-button--small" onClick={() => setShowSame(!showSame)}>
              {showSame ? "Hide unchanged" : "Show all"}
            </button>
          ) : null}
        </div>
        <table>
          <caption className="ui-visually-hidden">Files the pull request writes</caption>
          <tbody>
            {files.map((f) => (
              <tr key={f.path} className={styles[f.status]}>
                <td>
                  <code>{f.path}</code>
                </td>
                <td>{KIND[f.kind]}</td>
                <td>{STATUS[f.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.pr}>
        <button type="button" className="ui-button ui-button--ghost ui-button--small" aria-expanded={showBody} onClick={() => setShowBody(!showBody)}>
          {showBody ? "Hide" : "Show"} the pull request description
        </button>
        {showBody ? (
          <div className={styles.body}>
            <h3>{plan.title}</h3>
            {/* Sanitised: the description quotes the page's copy. */}
            <article className={markdown.doc} dangerouslySetInnerHTML={{ __html: body }} />
          </div>
        ) : null}
      </div>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className={styles.done} role="status">
          <strong>
            {result.created ? "Pull request opened" : result.unchanged ? "Pull request already up to date" : "Pull request updated"}:{" "}
            <a href={result.url} target="_blank" rel="noreferrer">
              #{result.number}
            </a>
          </strong>
          <p>{result.risk === "content" ? "It merges itself once the site's checks pass." : "It waits for a reviewer."}</p>
          {result.previews.length ? (
            <p>
              Previews:{" "}
              {result.previews.map((p, i) => (
                <span key={p.url}>
                  {i ? " · " : ""}
                  <a href={p.url} target="_blank" rel="noreferrer">
                    {p.name}
                  </a>
                </span>
              ))}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className={styles.actions}>
        {target ? (
          <button type="button" className="ui-button ui-button--primary" disabled={!!blocked || busy || plan.unchanged} onClick={onPublish}>
            {busy ? "Publishing…" : published ? "Publish the changes" : "Open a pull request"}
          </button>
        ) : null}
        <button type="button" className={`ui-button${target ? "" : " ui-button--primary"}`} disabled={!!blocked} onClick={onDownload}>
          Download for Cloudflare Pages
        </button>
        <span className={styles.why}>{plan.unchanged ? `${target?.base ?? "The site"} already has this version of the page.` : blocked}</span>
      </div>
    </div>
  );
}
