import { IMPORT_SERVICE } from "../api.ts";
import styles from "./DemoBanner.module.scss";

const REPO = "https://github.com/tywiththewifi/landing-page-harness";

export function DemoBanner({ onReset }: { onReset: () => void }) {
  return (
    <div className={styles.banner} role="note">
      {IMPORT_SERVICE ? (
        <span>
          <strong>Live demo.</strong> Scan any public site, or try Northloop, a made-up sample. Briefs are written from templates, not by AI,
          and your changes are only saved in this browser.
        </span>
      ) : (
        <span>
          <strong>Live demo.</strong> It uses Northloop, a made-up sample site, and replays a real scan of it. Briefs are written from
          templates, not by AI, and your changes are only saved in this browser.
        </span>
      )}
      <span className={styles.actions}>
        <a href={REPO} target="_blank" rel="noreferrer">
          Code on GitHub
        </a>
        <button type="button" onClick={onReset}>
          Reset demo
        </button>
      </span>
    </div>
  );
}
