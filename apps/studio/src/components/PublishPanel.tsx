import DOMPurify from "dompurify";
import { marked } from "marked";
import { useMemo, useState } from "react";
import type { PublishInfo, PublishResult } from "../api.ts";
import markdown from "./MarkdownView.module.scss";
import styles from "./PublishPanel.module.scss";

const STATUS: Record<string, string> = { added: "New", changed: "Changed", removed: "Removed", unchanged: "Same" };
const KIND: Record<string, string> = { page: "Page", source: "Page content", config: "Site settings", other: "Other" };

interface Props {
  info: PublishInfo;
  /** Why publishing isn't possible right now, if it isn't. */
  blocked: string | null;
  /** The only thing in the way is the checks' errors, and the server lets a person publish over them. */
  overridable: boolean;
  demo: boolean;
  busy: boolean;
  result: PublishResult | null;
  error: string | null;
  /** With a reason when publishing over the checks' errors. */
  onPublish: (override?: string) => void;
  onDownload: (override?: string) => void;
}

/** Where the page goes, how risky the change is, and the pull request that carries it. */
export function PublishPanel({ info, blocked, overridable, demo, busy, result, error, onPublish, onDownload }: Props) {
  const { plan, target, published } = info;
  const [showBody, setShowBody] = useState(false);
  const [showSame, setShowSame] = useState(false);
  const [anyway, setAnyway] = useState(false);
  const [reason, setReason] = useState("");
  const overriding = overridable && anyway;
  const override = overriding ? reason.trim() : "";
  const stopped = overriding ? (override ? null : "Say why you're publishing with problems.") : blocked;
  const body = useMemo(() => (showBody ? DOMPurify.sanitize(marked.parse(plan.body, { async: false })) : ""), [showBody, plan.body]);
  const changed = plan.changes.filter((c) => c.status !== "unchanged");
  const files = showSame ? plan.changes : changed;
  const content = plan.classification.risk === "content";

  return (
    <div className={styles.panel}>
      <div className={styles.target}>
        <div>
          <span className="ui-label">Where it goes</span>
          {target ? (
            <p>
              To your website's code on GitHub (<strong title={`${target.base}, on ${plan.branch}`}>{target.repo}</strong>), as a pull request: a proposed change your
              team can check before it goes live
              {target.reviewers.length ? <>. {target.reviewers.join(", ")} will review it</> : null}.
            </p>
          ) : demo ? (
            <p>In the demo, nothing is actually published. This shows what would be sent to your website, and the files you'd get if you download the page.</p>
          ) : (
            <>
              <p>
                Softlander isn't connected to your website yet, so download the page and upload it to Cloudflare Pages. To publish straight to your website, ask whoever
                set up Softlander to connect it to GitHub.
              </p>
              <details>
                <summary>Details for developers</summary>
                Set <code>LPH_GITHUB_REPO</code> and <code>LPH_GITHUB_TOKEN</code> on the server to publish as pull requests.
              </details>
            </>
          )}
          <p className={styles.url}>
            Goes live at <code>{info.config.origin}{plan.previews[0]?.path ?? ""}</code>
            {published ? (
              <>
                {" "}
                · last published in{" "}
                <a href={published.url} target="_blank" rel="noreferrer">
                  #{published.number}
                </a>
                {published.override ? <>, even though the checks found problems ({published.override.reason})</> : null}
              </>
            ) : null}
          </p>
        </div>
      </div>

      <div className={`${styles.risk} ${content ? styles.content : styles.review}`} title={plan.labels.join(", ")}>
        <strong>{content ? "Only words changed, so it goes live by itself once the checks pass" : "Someone needs to review this before it goes live"}</strong>
        <ul>
          {plan.classification.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
          {content ? <li>Your website runs the checks again before it goes live.</li> : null}
        </ul>
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
          {showBody ? "Hide" : "Show"} the description your team will see
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
            {result.created ? "Sent for review" : result.unchanged ? "Already sent, nothing new to add" : "Updated"}: pull request{" "}
            <a href={result.url} target="_blank" rel="noreferrer">
              #{result.number}
            </a>
          </strong>
          <p>
            {result.override
              ? "It was published even though the checks found problems, so someone has to review it, and your website's checks will keep failing until the problems are fixed."
              : result.risk === "content"
                ? "It goes live by itself once your website's checks pass."
                : "It goes live once someone on your team reviews and approves it."}
          </p>
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

      {overridable ? (
        <div className={`${styles.override} ${overriding ? styles.overriding : ""}`}>
          <label className={styles.toggle}>
            <input type="checkbox" checked={anyway} onChange={(e) => setAnyway(e.target.checked)} />
            <span>
              <strong>Publish anyway</strong>
              <small>
                For a test, or when you've looked at the problems and they don't matter here.{" "}
                {target
                  ? "It's flagged so someone always reviews it first, and your website's checks will still fail on it."
                  : "Your reason is saved with the page's files."}
              </small>
            </span>
          </label>
          {overriding ? (
            <label className={styles.reason}>
              <span className="ui-label">Why are you publishing with problems?</span>
              <textarea className="ui-input" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Testing the publishing flow; the copy gets written next." />
            </label>
          ) : null}
        </div>
      ) : null}

      <div className={styles.actions}>
        {target ? (
          <button
            type="button"
            className={`ui-button ${overriding ? styles.danger : "ui-button--primary"}`}
            disabled={!!stopped || busy || plan.unchanged}
            onClick={() => onPublish(override || undefined)}
          >
            {busy ? "Publishing…" : `${published ? "Publish the changes" : "Open a pull request"}${overriding ? " anyway" : ""}`}
          </button>
        ) : null}
        <button
          type="button"
          className={`ui-button${target ? "" : overriding ? ` ${styles.danger}` : " ui-button--primary"}`}
          disabled={!!stopped}
          onClick={() => onDownload(override || undefined)}
        >
          {overriding ? "Download anyway" : "Download the page (for Cloudflare Pages)"}
        </button>
        <span className={styles.why}>{plan.unchanged ? "Your website already has this version of the page." : stopped}</span>
      </div>
    </div>
  );
}
