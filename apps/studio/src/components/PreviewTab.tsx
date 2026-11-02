import { useEffect, useState } from "react";
import type { Brand } from "@lph/tokens";
import { api } from "../api.ts";
import styles from "./PreviewTab.module.scss";

/** The starter components rendered with the brand's tokens, isolated in an iframe. */
export function PreviewTab({ brand }: { brand: Brand }) {
  const [width, setWidth] = useState<"desktop" | "mobile">("desktop");
  const [html, setHtml] = useState<string | null>(null);

  // Re-render after each saved edit. The previous page stays up until the new one arrives.
  useEffect(() => {
    api.previewHtml(brand.id).then(setHtml, () => setHtml("<p style=\"font-family:sans-serif;padding:24px\">Couldn't render the preview.</p>"));
  }, [brand.id, brand.updatedAt]);

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <p>A sample page built with your brand's styles. If it looks like your site, we picked everything up correctly.</p>
        <div className={styles.toggle} role="group" aria-label="Screen size">
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
          srcDoc={html ?? ""}
          sandbox="allow-same-origin"
        />
      </div>
    </div>
  );
}
