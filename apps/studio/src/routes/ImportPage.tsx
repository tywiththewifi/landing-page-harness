import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { api, waitForJob } from "../api.ts";
import styles from "./ImportPage.module.scss";

const STEPS = ["Reading the home page", "Reading the product page", "Checking mobile type sizes", "Building the design system"];

export function ImportPage() {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [chooseProduct, setChooseProduct] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<Awaited<ReturnType<typeof api.listBrands>>>([]);

  useEffect(() => {
    api.listBrands().then(setRecent).catch(() => {});
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    try {
      setStep("Starting");
      const job = await api.importBrand(normalized, chooseProduct ? productUrl : undefined);
      const done = await waitForJob(job, setStep);
      navigate(`/brands/${done.brandId}`);
    } catch (err) {
      setError((err as Error).message);
      setStep(null);
    }
  }

  const activeIndex = step ? STEPS.findIndex((s) => step.startsWith(s.split(" (")[0]!)) : -1;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Set up your brand</h1>
      <p className={styles.lead}>
        Share your website. We'll read your home page and main product page, measure the CSS they actually render, and turn it into a
        design system you can review before anything is generated.
      </p>

      <form className={styles.form} onSubmit={submit}>
        <label className="ui-label" htmlFor="url">
          Website
        </label>
        <div className={styles.inputWrap}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className={styles.icon}>
            <path d="M6.5 9.5l3-3M7 4.5l1-1a2.8 2.8 0 014 4l-1 1M9 11.5l-1 1a2.8 2.8 0 01-4-4l1-1" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          </svg>
          <input
            id="url"
            className={`ui-input ${styles.urlInput}`}
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={!!step}
            autoFocus
            required
          />
        </div>

        <label className={styles.toggle}>
          <input type="checkbox" checked={chooseProduct} onChange={(e) => setChooseProduct(e.target.checked)} disabled={!!step} />
          Choose the product page myself (otherwise we pick the most product-like link in your navigation)
        </label>
        {chooseProduct ? (
          <input
            className="ui-input"
            placeholder="https://example.com/product"
            value={productUrl}
            onChange={(e) => setProductUrl(e.target.value)}
            disabled={!!step}
          />
        ) : null}

        <button className={`ui-button ui-button--primary ${styles.submit}`} disabled={!url || !!step}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M7 1l1.4 4.6L13 7l-4.6 1.4L7 13l-1.4-4.6L1 7l4.6-1.4z" fill="currentColor" />
          </svg>
          {step ? "Importing…" : "Import brand"}
        </button>
      </form>

      {step ? (
        <ol className={styles.progress} aria-live="polite">
          {STEPS.map((s, i) => (
            <li key={s} className={i < activeIndex ? styles.done : i === activeIndex ? styles.active : undefined}>
              <span className={styles.dot} aria-hidden="true" />
              {i === activeIndex ? step : s}
            </li>
          ))}
        </ol>
      ) : null}

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {recent.length && !step ? (
        <section className={styles.recent}>
          <h2>Recent brands</h2>
          <ul>
            {recent.slice(0, 6).map((b) => (
              <li key={b.id}>
                <Link to={`/brands/${b.id}`}>{b.name}</Link>
                <span>{new URL(b.url).host}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
