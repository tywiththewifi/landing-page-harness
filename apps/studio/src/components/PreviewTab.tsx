import { useState } from "react";
import type { Brand } from "@lph/tokens";
import styles from "./PreviewTab.module.scss";

/** The starter components rendered with the brand's tokens, isolated in an iframe. */
export function PreviewTab({ brand }: { brand: Brand }) {
  const [width, setWidth] = useState<"desktop" | "mobile">("desktop");
  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <p>A sample page built only from the starter components and your tokens. If it looks like your site, the tokens are right.</p>
        <div className={styles.toggle} role="group" aria-label="Viewport">
          {(["desktop", "mobile"] as const).map((w) => (
            <button key={w} aria-pressed={width === w} onClick={() => setWidth(w)}>
              {w === "desktop" ? "Desktop" : "Mobile"}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.frameWrap}>
        <iframe
          title={`${brand.name} preview`}
          className={styles.frame}
          style={{ width: width === "desktop" ? "100%" : 390 }}
          src={`/api/brands/${brand.id}/preview.html?v=${encodeURIComponent(brand.updatedAt)}`}
          sandbox="allow-same-origin"
        />
      </div>
    </div>
  );
}
