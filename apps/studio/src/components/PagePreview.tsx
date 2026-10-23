import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./PagePreview.module.scss";

/**
 * The page exactly as it will be published, in a sandboxed frame. The frame has no access
 * to the studio, so a small script reports its scroll position, which keeps the reader's
 * place when an edit re-renders it, and scrolls to a section when the editor asks.
 */
const bridge = (y: number) => `<script>
(function () {
  scrollTo(0, ${Math.round(y)});
  addEventListener("scroll", function () { parent.postMessage({ lphPreviewScroll: scrollY }, "*"); }, { passive: true });
  addEventListener("message", function (e) {
    var id = e.data && e.data.lphScrollTo;
    var el = id && document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  });
})();
</script>`;

export function PagePreview({ html, title, focus, path }: { html: string; title: string; focus: { id: string; at: number } | null; path: string }) {
  const [width, setWidth] = useState<"desktop" | "mobile">("desktop");
  const frame = useRef<HTMLIFrameElement>(null);
  const scroll = useRef(0);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source === frame.current?.contentWindow && typeof e.data?.lphPreviewScroll === "number") scroll.current = e.data.lphPreviewScroll;
    };
    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  }, []);

  // Rebuilt on each change; the scroll position is read when the HTML changes, not on every scroll.
  const doc = useMemo(() => {
    const end = html.lastIndexOf("</body>");
    return end < 0 ? html : `${html.slice(0, end)}${bridge(scroll.current)}${html.slice(end)}`;
  }, [html]);

  useEffect(() => {
    if (focus) frame.current?.contentWindow?.postMessage({ lphScrollTo: focus.id }, "*");
  }, [focus]);

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <span className={styles.url}>
          <span aria-hidden="true">🔒</span> yoursite.com<strong>{path}</strong>
        </span>
        <div className={styles.toggle} role="group" aria-label="Viewport">
          {(["desktop", "mobile"] as const).map((w) => (
            <button key={w} type="button" aria-pressed={width === w} onClick={() => setWidth(w)}>
              {w === "desktop" ? "Desktop" : "Mobile"}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.frameWrap}>
        <iframe ref={frame} title={title} className={styles.frame} style={{ width: width === "desktop" ? "100%" : 390 }} srcDoc={doc} sandbox="allow-scripts allow-forms" />
      </div>
    </div>
  );
}
