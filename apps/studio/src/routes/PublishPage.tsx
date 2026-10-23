import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import type { GateReport as Report } from "@lph/checks/browser";
import type { Page } from "@lph/page/browser";
import { api, DEMO, waitForJob, type PublishInfo, type PublishResult } from "../api.ts";
import { GateReport } from "../components/GateReport.tsx";
import { PublishPanel } from "../components/PublishPanel.tsx";
import styles from "./PublishPage.module.scss";
import review from "./ReviewPage.module.scss";

/** Publish: the gate runs on every version, then the page goes out as a pull request or a Cloudflare Pages folder. */
export function PublishPage() {
  const { id } = useParams();
  const [page, setPage] = useState<Page | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [info, setInfo] = useState<PublishInfo | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PublishResult | null>(null);

  const refresh = useCallback(async () => {
    if (!id) return;
    const [p, i] = await Promise.all([api.page(id), api.publishInfo(id)]);
    setPage(p);
    setReport(i.report);
    setInfo(i);
    return { page: p, report: i.report };
  }, [id]);

  const runChecks = useCallback(async () => {
    if (!id) return;
    setRunning("Starting");
    setError(null);
    try {
      await waitForJob(await api.runGate(id), setRunning);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(null);
    }
  }, [id, refresh]);

  // Open on a current report: run the checks when there isn't one. Once, even in StrictMode.
  const autoRun = useRef(false);
  useEffect(() => {
    refresh().then(
      (loaded) => {
        if (!loaded || autoRun.current || (loaded.report && loaded.report.pageUpdatedAt === loaded.page.updatedAt)) return;
        autoRun.current = true;
        void runChecks();
      },
      (e: Error) => setError(e.message),
    );
  }, [refresh, runChecks]);

  if (!page || !info) {
    return <div className={review.state}>{error ?? "Loading…"}</div>;
  }

  const stale = !!report && report.pageUpdatedAt !== page.updatedAt;
  const notYet = running
    ? "The checks are running."
    : !info.gate
      ? "Run the checks on this version of the page first."
      : info.target && info.gate.environment !== "server"
        ? "The checks have to run on the server first."
        : null;
  // Errors block publishing, unless a person publishes anyway and says why.
  const errors = !notYet && info.gate?.verdict === "blocked";
  const blocked = notYet ?? (errors ? "Fix the errors the checks found, then run them again." : null);

  const publish = async (override?: string) => {
    setBusy(true);
    setPublishError(null);
    try {
      setResult(await api.publish(page.id, override));
      await refresh();
    } catch (e) {
      setPublishError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const download = async (override?: string) => {
    setPublishError(null);
    try {
      const blob = await api.siteZip(page.id, override);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${page.slug}-cloudflare-pages.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) {
      setPublishError((e as Error).message);
    }
  };

  return (
    <div className={review.page}>
      <div className={review.head}>
        <div>
          <h1>Publish</h1>
          <p>Every version is checked as the HTML that will go live. Errors block publishing unless you publish anyway and say why; new warnings go to a reviewer.</p>
        </div>
        <div className={review.actions}>
          <Link className="ui-button" to={`/pages/${page.id}`}>
            Back to the editor
          </Link>
          <button className="ui-button" disabled={!!running} onClick={runChecks}>
            {running ? "Checking…" : "Run the checks again"}
          </button>
        </div>
      </div>

      <div className={styles.grid}>
        <section className={review.card} aria-labelledby="checks-title">
          <div className={review.cardHead}>
            <div className={review.identity}>
              <strong id="checks-title">Checks</strong>
              <span>{page.title}</span>
            </div>
          </div>
          <div className={styles.body}>
            {error ? <p className={review.error}>{error}</p> : null}
            {running ? (
              <p className={styles.running} role="status">
                <span className={styles.spinner} aria-hidden="true" />
                {running}
              </p>
            ) : null}
            {report ? <GateReport report={report} pageId={page.id} stale={stale} /> : running ? null : <p className={styles.empty}>The checks haven't run yet.</p>}
          </div>
        </section>

        <section className={review.card} aria-labelledby="publish-title">
          <div className={review.cardHead}>
            <div className={review.identity}>
              <strong id="publish-title">{info.target ? "Pull request" : "Publish"}</strong>
            </div>
          </div>
          <div className={styles.body}>
            <PublishPanel info={info} blocked={blocked} overridable={errors && info.overrideAllowed} demo={DEMO} busy={busy} result={result} error={publishError} onPublish={publish} onDownload={download} />
          </div>
        </section>
      </div>
    </div>
  );
}
