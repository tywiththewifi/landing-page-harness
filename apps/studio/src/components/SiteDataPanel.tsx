import { useState } from "react";
import type { Brand } from "@lph/tokens";
import { api, DEMO, IMPORT_SERVICE } from "../api.ts";
import styles from "./SiteDataPanel.module.scss";

/**
 * Connects the site's own MCP server, if it has one, so briefs can use its plans, prices
 * and help articles. Shows which tools will be called and lets a person allow tools the
 * server doesn't mark read-only.
 */
export function SiteDataPanel({
  brand,
  onBrand,
  use,
  onUse,
  disabled,
}: {
  brand: Brand;
  onBrand: (b: Brand) => void;
  use: boolean;
  onUse: (v: boolean) => void;
  disabled?: boolean;
}) {
  const [url, setUrl] = useState(DEMO ? "https://northloop.example/mcp" : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const mcp = brand.siteMcp;

  async function run(work: () => Promise<Brand>) {
    setBusy(true);
    setError(null);
    try {
      onBrand(await work());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Not a <form>: the panel sits inside the brief form, and forms can't nest.
  function connect() {
    if (!url.trim() || busy) return;
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    void run(() => api.connectSiteMcp(brand.id, normalized));
  }

  if (!mcp) {
    return (
      <div className={styles.panel}>
        <label className="ui-label" htmlFor="mcp-url">
          Connect your data (optional)
        </label>
        <div className={styles.connect}>
          <input
            id="mcp-url"
            className="ui-input"
            placeholder="https://example.com/mcp"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                connect();
              }
            }}
            disabled={busy || disabled}
          />
          <button type="button" className="ui-button" onClick={connect} disabled={!url.trim() || busy || disabled}>
            {busy ? "Connecting…" : "Connect"}
          </button>
        </div>
        <span className={styles.hint}>
          If your site has an MCP server (a way for AI tools to look up your content), the brief can use what it knows, like plans, prices and
          help articles. We only use the parts that look things up, unless you allow more.
          {IMPORT_SERVICE
            ? " In the demo, try northloop.example/mcp, a sample server. Other addresses work too."
            : DEMO
              ? " In the demo, any address connects to Northloop's sample server."
              : ""}
        </span>
        {error ? <span className={styles.error}>{error}</span> : null}
      </div>
    );
  }

  const used = mcp.tools.filter((t) => t.use);
  // The checkbox flips at once; the server's answer (or the old state, on failure) replaces it.
  const toggle = (name: string, on: boolean) => {
    const allowed = on ? [...mcp.allowed, name] : mcp.allowed.filter((n) => n !== name);
    onBrand({ ...brand, siteMcp: { ...mcp, allowed } });
    void run(() => api.allowSiteTools(brand.id, allowed).catch((err) => (onBrand(brand), Promise.reject(err))));
  };

  return (
    <div className={styles.panel}>
      <span className="ui-label">Connected data</span>
      <div className={styles.card}>
        <div className={styles.head}>
          <span className={styles.dot} aria-hidden="true" />
          <strong>{mcp.name}</strong>
          <code>{mcp.url.replace(/^https?:\/\//, "")}</code>
          <button type="button" className="ui-button ui-button--ghost ui-button--small" onClick={() => run(() => api.disconnectSiteMcp(brand.id))} disabled={busy || disabled}>
            Disconnect
          </button>
        </div>
        <label className={styles.use}>
          <input type="checkbox" checked={use} onChange={(e) => onUse(e.target.checked)} disabled={disabled} />
          Use it for this brief
        </label>
        <button type="button" className={styles.summary} onClick={() => setOpen(!open)} aria-expanded={open}>
          We'll use {used.length} of its {mcp.tools.length} tools
          {mcp.resources.length ? ` and read ${mcp.resources.length} document${mcp.resources.length === 1 ? "" : "s"}` : ""} {open ? "▴" : "▾"}
        </button>
        {open ? (
          <ul className={styles.tools}>
            {mcp.tools.map((t) => (
              <li key={t.name} className={t.use ? styles.on : undefined}>
                <span className={styles.mark} aria-hidden="true">
                  {t.use ? "✓" : "–"}
                </span>
                <div>
                  <strong title={t.name}>{t.title}</strong>
                  <span>{t.reason}</span>
                </div>
                {!t.readOnly && t.fillable ? (
                  <label className={styles.allow} title="Only allow this if you're sure it just looks things up and doesn't change anything. It runs every time a brief is written.">
                    <input type="checkbox" checked={mcp.allowed.includes(t.name)} onChange={(e) => toggle(t.name, e.target.checked)} disabled={busy || disabled} />
                    Allow
                  </label>
                ) : null}
              </li>
            ))}
            {mcp.resources.map((r) => (
              <li key={r.uri} className={styles.on}>
                <span className={styles.mark} aria-hidden="true">
                  ✓
                </span>
                <div>
                  <strong title={r.uri}>{r.name}</strong>
                  <span>A document we'll read.</span>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {error ? <span className={styles.error}>{error}</span> : null}
    </div>
  );
}
