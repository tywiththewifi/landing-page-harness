import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./PagePreview.module.scss";

/**
 * The page exactly as it will be published, in a sandboxed frame. The frame has no access
 * to the studio, so a small script reports its scroll position, which keeps the reader's
 * place when an edit re-renders it, and scrolls to a section when the editor asks. It also
 * keeps links in the frame: a srcdoc frame resolves them against the studio's address, so
 * "#form" or "/" would load the studio inside the preview. Section links scroll; the others
 * are reported, since they only lead somewhere on the published site.
 */
const bridge = (y: number) => `<script>
(function () {
  scrollTo(0, ${Math.round(y)});
  parent.postMessage({ lphPreviewReady: true }, "*");
  addEventListener("scroll", function () { parent.postMessage({ lphPreviewScroll: scrollY }, "*"); }, { passive: true });
  addEventListener("message", function (e) {
    var id = e.data && e.data.lphScrollTo;
    var el = id && document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a || e.defaultPrevented) return;
    e.preventDefault();
    var href = a.getAttribute("href");
    if (href.charAt(0) !== "#") return parent.postMessage({ lphPreviewLink: href }, "*");
    var el = href.length > 1 && document.getElementById(decodeURIComponent(href.slice(1)));
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    else if (href === "#") scrollTo({ top: 0, behavior: "smooth" });
  });
})();
</script>`;

export function PagePreview({ html, title, focus, path }: { html: string; title: string; focus: { id: string; at: number } | null; path: string }) {
  const [width, setWidth] = useState<"desktop" | "mobile">("desktop");
  const frame = useRef<HTMLIFrameElement>(null);
  const scroll = useRef(0);
  // Covers the frame until the first render has painted; later edits swap in place.
  const [ready, setReady] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      if (typeof e.data?.lphPreviewScroll === "number") scroll.current = e.data.lphPreviewScroll;
      if (e.data?.lphPreviewReady) setReady(true);
      if (typeof e.data?.lphPreviewLink === "string") setLink(e.data.lphPreviewLink);
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

  useEffect(() => {
    if (!link) return;
    const t = setTimeout(() => setLink(null), 4000);
    return () => clearTimeout(t);
  }, [link]);

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
        <iframe ref={frame} title={title} className={styles.frame} style={{ width: width === "desktop" ? "100%" : 390 }} srcDoc={doc} sandbox="allow-scripts allow-forms" onLoad={() => setReady(true)} />
        {ready ? null : (
          <div className={styles.loading} role="status">
            <span className={styles.spinner} aria-hidden="true" />
            Rendering the preview…
          </div>
        )}
        {link ? (
          <p className={styles.toast} role="status">
            Links don't open in the preview. On the published page this one goes to <strong>{link === "/" ? "the home page" : link}</strong>.
          </p>
        ) : null}
      </div>
    </div>
  );
}
