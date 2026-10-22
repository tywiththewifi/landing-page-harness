import { IMPORT_SERVICE } from "../api.ts";
import styles from "./DemoBanner.module.scss";

const REPO = "https://github.com/tywiththewifi/landing-page-harness";

export function DemoBanner({ onReset }: { onReset: () => void }) {
  return (
    <div className={styles.banner} role="note">
      {IMPORT_SERVICE ? (
        <span>
          <strong>Live demo.</strong> Import any public site, or Northloop, a fictional sample. A small service reads the sites; everything
          else runs in your browser, with briefs from the offline writer. Edits stay in this browser.
        </span>
      ) : (
        <span>
          <strong>Live demo.</strong> It runs in your browser on Northloop, a fictional sample site: imports replay a real extraction, and
          briefs come from the offline writer. Edits stay in this browser.
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
