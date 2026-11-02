import { Link } from "react-router";
import type { Brand } from "@lph/tokens";
import { DEMO } from "../api.ts";
import styles from "./ConfirmPanel.module.scss";

export function ConfirmPanel({ brand, result, onClose }: { brand: Brand; result: { dir: string; files: string[] }; onClose: () => void }) {
  const base = `${DEMO ? "http://localhost:8787" : location.origin}/api/brands/${brand.id}`;
  return (
    <div className={styles.panel} role="status">
      <div className={styles.head}>
        <strong>{DEMO ? `Brand saved. Outside the demo, this also creates ${result.files.length} files you can use elsewhere.` : `Brand saved. We created ${result.files.length} files you can use elsewhere.`}</strong>
        <button className="ui-button ui-button--ghost ui-button--small" onClick={onClose} aria-label="Dismiss">
          ✕
        </button>
      </div>
      <div className={styles.cols}>
        <div>
          <span className="ui-label">Saved in {result.dir}</span>
          <ul>
            {result.files.map((f) => (
              <li key={f}>
                <code>{f.split("/").pop()}</code>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <span className="ui-label">For developers and AI tools</span>
          <ul>
            <li>
              <code>GET {base}/design.md</code>
            </li>
            <li>
              <code>GET {base}/tokens.css</code>
            </li>
            <li>
              <code>GET {base}/tokens.json</code>
            </li>
            <li>
              <a href={DEMO ? "https://github.com/tywiththewifi/landing-page-harness#for-agents" : "/api/openapi.json"} target="_blank" rel="noreferrer">
                API reference
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className={styles.next}>
        <span>Next: describe the page or campaign you want, and we'll write the brief.</span>
        <Link className="ui-button ui-button--primary" to={`/brands/${brand.id}/briefs/new`}>
          Plan a page →
        </Link>
      </div>
    </div>
  );
}
