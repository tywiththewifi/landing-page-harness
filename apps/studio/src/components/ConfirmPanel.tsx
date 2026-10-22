import { Link } from "react-router";
import type { Brand } from "@lph/tokens";
import { DEMO } from "../api.ts";
import styles from "./ConfirmPanel.module.scss";

export function ConfirmPanel({ brand, result, onClose }: { brand: Brand; result: { dir: string; files: string[] }; onClose: () => void }) {
  const base = `${DEMO ? "http://localhost:8787" : location.origin}/api/brands/${brand.id}`;
  return (
    <div className={styles.panel} role="status">
      <div className={styles.head}>
        <strong>{DEMO ? `Brand confirmed. With the server running, this writes ${result.files.length} files.` : `Brand confirmed. ${result.files.length} files written.`}</strong>
        <button className="ui-button ui-button--ghost ui-button--small" onClick={onClose} aria-label="Dismiss">
          ✕
        </button>
      </div>
      <div className={styles.cols}>
        <div>
          <span className="ui-label">In {result.dir}</span>
          <ul>
            {result.files.map((f) => (
              <li key={f}>
                <code>{f.split("/").pop()}</code>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <span className="ui-label">For any agent</span>
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
                OpenAPI description
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
