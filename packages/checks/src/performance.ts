import type { Budget, GateIssue, PerfSample, Severity } from "./types.ts";

/** Gzipped size, with the streams API both browsers and Node have. */
export async function gzipSize(text: string): Promise<number> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return (await new Response(stream).arrayBuffer()).byteLength;
}

const external = (url: string | null) => !!url && !url.startsWith("data:");

/**
 * What the HTML alone says about load cost: its size, the requests it starts and the
 * ones that hold up the first paint. A browser run adds real transfer sizes and timings.
 */
export async function staticPerf(html: string, doc: Document, path: string): Promise<PerfSample> {
  const head = doc.head;
  const stylesheets = Array.from(doc.querySelectorAll('link[rel="stylesheet"]')).filter((l) => external(l.getAttribute("href")));
  const scripts = Array.from(doc.querySelectorAll("script[src]"));
  const images = Array.from(doc.querySelectorAll("img[src], source[srcset], video[poster]")).filter((el) => external(el.getAttribute("src") ?? el.getAttribute("srcset") ?? el.getAttribute("poster")));
  const fontFiles = Array.from(doc.querySelectorAll("style")).flatMap((s) => Array.from((s.textContent ?? "").matchAll(/url\(\s*["']?(?!data:)[^)"']+/g)));
  const blockingCss = stylesheets.filter((l) => head.contains(l) && !/^(print|not all)$/i.test(l.getAttribute("media") ?? ""));
  const blockingJs = scripts.filter((s) => head.contains(s) && !s.hasAttribute("async") && !s.hasAttribute("defer") && s.getAttribute("type") !== "module");
  return {
    path,
    htmlBytes: new TextEncoder().encode(html).byteLength,
    htmlGzipBytes: await gzipSize(html),
    requests: stylesheets.length + scripts.length + images.length + fontFiles.length,
    transferBytes: null,
    renderBlocking: blockingCss.length + blockingJs.length,
    domNodes: doc.querySelectorAll("*").length,
    lcpMs: null,
    cls: null,
    tbtMs: null,
  };
}

const kb = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`);

export function perfIssues(samples: PerfSample[], budget: Budget, doc?: (path: string) => Document | undefined): GateIssue[] {
  const issues: GateIssue[] = [];
  for (const s of samples) {
    const over = (id: keyof Budget, value: number | null, shown: (v: number) => string, what: string) => {
      if (value === null) return;
      const limit = budget[id];
      const severity: Severity | null = value > limit.fail ? "error" : value > limit.warn ? "warning" : null;
      if (severity) issues.push({ id: `performance.${id}`, check: "performance", severity, path: s.path, message: `${what} ${shown(value)}, over the limit of ${shown(severity === "error" ? limit.fail : limit.warn)}.` });
    };
    over("htmlGzipKb", s.htmlGzipBytes / 1024, (v) => kb(v * 1024), "The page itself is");
    over("transferKb", s.transferBytes === null ? null : s.transferBytes / 1024, (v) => kb(v * 1024), "Visitors download");
    over("requests", s.requests, (v) => `${v} files`, "The page loads");
    over("renderBlocking", s.renderBlocking, (v) => `${v}`, "Files that delay showing the page:");
    over("domNodes", s.domNodes, (v) => `${v} elements`, "The page has");
    over("lcpMs", s.lcpMs, (v) => `${(v / 1000).toFixed(1)} s`, "The main content shows after");
    over("cls", s.cls, (v) => v.toFixed(2), "The layout jumps around by");
    over("tbtMs", s.tbtMs, (v) => `${Math.round(v)} ms`, "The page is too busy to respond for");

    // Images without dimensions shift the layout when they load.
    const unsized = doc?.(s.path)?.querySelectorAll("img:not([width]), img:not([height])").length ?? 0;
    if (unsized) issues.push({ id: "performance.image-size", check: "performance", severity: "info", path: s.path, message: `${unsized === 1 ? "An image has" : `${unsized} images have`} no set size, so the page jumps around as ${unsized === 1 ? "it loads" : "they load"}.` });
  }
  return issues;
}
