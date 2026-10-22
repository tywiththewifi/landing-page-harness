import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { Brand } from "@lph/tokens";
import { api, DEMO, waitForJob, type BriefSummary, type SeoProviderInfo } from "../api.ts";
import { SiteDataPanel } from "../components/SiteDataPanel.tsx";
import styles from "./NewBriefPage.module.scss";

const EXAMPLES = [
  "Landing page for our new HubSpot integration for ops managers",
  "Comparison page: us vs our main competitor, for teams about to switch",
  "Webinar sign-up page for a session on automating month-end close",
  "Page announcing our launch in Germany",
];


export function NewBriefPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [brand, setBrand] = useState<Brand | null>(null);
  const [briefs, setBriefs] = useState<BriefSummary[]>([]);
  const [providers, setProviders] = useState<SeoProviderInfo[]>([]);
  const [generator, setGenerator] = useState<{ name: string; model: string | null } | null>(null);
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState<string>("");
  const [useSiteData, setUseSiteData] = useState(true);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api.brand(id).then(setBrand, (e: Error) => setError(e.message));
    api.listBriefs(id).then(setBriefs, () => {});
    api.seoProviders().then((list) => {
      setProviders(list);
      setProvider(list.at(-1)?.id ?? "");
    }, () => {});
    api.generator().then(setGenerator, () => {});
  }, [id]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!id) return;
    setError(null);
    try {
      setStep("Starting");
      const done = await waitForJob(await api.createBrief(id, prompt, provider || undefined, useSiteData), setStep);
      navigate(`/briefs/${done.briefId}`);
    } catch (err) {
      setError((err as Error).message);
      setStep(null);
    }
  }

  const steps = [...(brand?.siteMcp && useSiteData ? ["Reading site data"] : []), "Researching keywords", "Writing the brief"];
  const activeIndex = step ? steps.findIndex((s) => step.startsWith(s)) : -1;
  const current = providers.find((p) => p.id === provider);

  return (
    <div className={styles.page}>
      <Link to={`/brands/${id}`} className={styles.back}>
        ← {brand?.name ?? "Brand"}
      </Link>
      <h1 className={styles.title}>What do you want to make?</h1>
      <p className={styles.lead}>
        Describe the page or campaign. We'll write a standard marketing brief from it, grounded in what {brand?.name ?? "your site"} already says, for you to
        edit before anything is built.
      </p>

      <form className={styles.form} onSubmit={submit}>
        <label className="ui-label" htmlFor="prompt">
          Page or campaign
        </label>
        <textarea
          id="prompt"
          className={`ui-input ${styles.prompt}`}
          placeholder="e.g. A landing page for our new HubSpot integration, aimed at ops managers at agencies"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={!!step}
          rows={4}
          autoFocus
          required
        />
        <div className={styles.examples} aria-label="Examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" onClick={() => setPrompt(ex)} disabled={!!step}>
              {ex}
            </button>
          ))}
        </div>

        {brand ? <SiteDataPanel brand={brand} onBrand={setBrand} use={useSiteData} onUse={setUseSiteData} disabled={!!step} /> : null}

        <div className={styles.options}>
          <label className={styles.option}>
            <span className="ui-label">SEO and AEO data</span>
            <select className="ui-input" value={provider} onChange={(e) => setProvider(e.target.value)} disabled={!!step}>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {current ? <span className={styles.hint}>{current.description}</span> : null}
            {providers.length === 1 ? (
              <span className={styles.hint}>
                Connect Semrush, Ahrefs, Search Console or any tool through one endpoint:{" "}
                <a href="https://github.com/tywiththewifi/landing-page-harness/blob/main/docs/seo-providers.md" target="_blank" rel="noreferrer">
                  how to connect
                </a>
                .
              </span>
            ) : null}
          </label>
          <div className={styles.option}>
            <span className="ui-label">Written by</span>
            <span className={styles.writer}>
              {generator?.name === "claude" ? `Claude (${generator.model})` : generator ? "Offline template" : "…"}
            </span>
            {generator?.name === "template" ? (
              <span className={styles.hint}>
                {DEMO
                  ? "In the demo, the offline template writes the brief: it reuses the site's copy and marks the gaps. With an API key on your own server, Claude writes it."
                  : "Set ANTHROPIC_API_KEY on the server for a brief tailored to your request. The template reuses your site's copy and marks the gaps."}
              </span>
            ) : null}
          </div>
        </div>

        <button className={`ui-button ui-button--primary ${styles.submit}`} disabled={!prompt.trim() || !!step}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M7 1l1.4 4.6L13 7l-4.6 1.4L7 13l-1.4-4.6L1 7l4.6-1.4z" fill="currentColor" />
          </svg>
          {step ? "Writing…" : "Write the brief"}
        </button>
      </form>

      {step ? (
        <ol className={styles.progress} aria-live="polite">
          {steps.map((s, i) => (
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

      {briefs.length && !step ? (
        <section className={styles.recent}>
          <h2>Briefs for {brand?.name}</h2>
          <ul>
            {briefs.map((b) => (
              <li key={b.id}>
                <Link to={`/briefs/${b.id}`}>{b.title}</Link>
                <span>{b.funnelStage}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
