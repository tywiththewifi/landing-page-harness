import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import axe from "axe-core";
import { parseHTML } from "linkedom";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { AXE_OPTIONS, type AxeOutcome } from "./axe.ts";
import type { GateRunner } from "./gate.ts";
import type { PerfSample } from "./types.ts";

/** The pages are served from a name that never resolves, so nothing else can answer for it. */
const ORIGIN = "https://gate.lph.invalid";
const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1280, height: 900 } };

export interface ServerRunnerOptions {
  /** Reuse a browser (the API keeps one). One is launched and closed otherwise. */
  browser?: Browser;
  /**
   * Every other address the page loads from (web fonts, the logo) is checked with this,
   * as imports are, so a brand can't point the gate's browser at an internal service.
   */
  allowAddress?: (ip: string) => boolean;
  /** Don't load anything but the page itself. For tests and offline CI. */
  offline?: boolean;
}

/** linkedom's Document is close enough to the DOM's for the checks, which only read. */
export const parseDocument = (html: string) => parseHTML(html).document as unknown as Document;

/**
 * The gate's runner on a server: linkedom for the HTML checks, Chromium for axe and the
 * lab measurements.
 */
export async function serverRunner(opts: ServerRunnerOptions = {}): Promise<GateRunner & { close(): Promise<void> }> {
  const browser = opts.browser ?? (await chromium.launch({ headless: true, executablePath: process.env.LPH_CHROMIUM_PATH || undefined }));
  const resolved = new Map<string, Promise<string[]>>();
  const addresses = (host: string) => {
    if (isIP(host)) return Promise.resolve([host]);
    if (!resolved.has(host)) resolved.set(host, lookup(host, { all: true }).then((all) => all.map((a) => a.address), () => []));
    return resolved.get(host)!;
  };

  /** A context that serves `html` at `path` and holds every other request to the address rule. */
  const open = async (html: string, path: string, device: typeof MOBILE | typeof DESKTOP) => {
    const context = await browser.newContext({ ...device, serviceWorkers: "block" });
    // Bundlers can wrap functions with a __name helper that doesn't exist in the page.
    await context.addInitScript("window.__name = (f) => f;");
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === ORIGIN) {
        return url.pathname === path
          ? route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html })
          : route.fulfill({ status: 404, body: "" });
      }
      if (opts.offline || !/^https?:$/.test(url.protocol)) return route.abort("blockedbyclient");
      if (opts.allowAddress && (await addresses(url.hostname.replace(/^\[|\]$/g, ""))).some((a) => !opts.allowAddress!(a))) return route.abort("blockedbyclient");
      return route.continue();
    });
    return context;
  };

  const close = async (context: BrowserContext) => context.close().catch(() => {});

  return {
    environment: "server",
    parse: parseDocument,

    async axe(html, { path, viewport }) {
      const context = await open(html, path, viewport === "desktop" ? DESKTOP : MOBILE);
      try {
        const page = await context.newPage();
        await page.goto(ORIGIN + path, { waitUntil: "load", timeout: 30000 });
        await page.addScriptTag({ content: axe.source });
        return await page.evaluate((options) => (window as unknown as { axe: { run: (d: Document, o: unknown) => Promise<AxeOutcome> } }).axe.run(document, options), AXE_OPTIONS as unknown);
      } finally {
        await close(context);
      }
    },

    async measure(html, path): Promise<Partial<PerfSample>> {
      const context = await open(html, path, MOBILE);
      try {
        // Lab metrics, observed from the first byte. Long tasks over 50 ms count towards blocking time.
        await context.addInitScript(() => {
          const m = { lcp: 0, cls: 0, tbt: 0 };
          (window as unknown as { __lph: typeof m }).__lph = m;
          const watch = (type: string, fn: (e: PerformanceEntry & Record<string, number>) => void) => {
            try {
              new PerformanceObserver((list) => list.getEntries().forEach((e) => fn(e as PerformanceEntry & Record<string, number>))).observe({ type, buffered: true });
            } catch {
              // Not supported in this browser.
            }
          };
          watch("largest-contentful-paint", (e) => (m.lcp = e.renderTime || e.loadTime || e.startTime));
          watch("layout-shift", (e) => {
            if (!e.hadRecentInput) m.cls += e.value ?? 0;
          });
          watch("longtask", (e) => (m.tbt += Math.max(0, e.duration - 50)));
        });
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        // Lighthouse's mobile profile slows the CPU four times.
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        let requests = 0;
        let transfer = new TextEncoder().encode(html).byteLength;
        const sizes: Promise<void>[] = [];
        page.on("requestfinished", (req) => {
          if (new URL(req.url()).origin === ORIGIN) return;
          requests++;
          sizes.push(req.sizes().then((s) => void (transfer += s.responseBodySize + s.responseHeadersSize), () => {}));
        });
        page.on("requestfailed", (req) => {
          if (new URL(req.url()).origin !== ORIGIN) requests++;
        });
        await page.goto(ORIGIN + path, { waitUntil: "load", timeout: 30000 });
        await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
        // LCP is final once the page settles; give late layout shifts a moment.
        await page.waitForTimeout(500);
        const lab = await page.evaluate(() => ({ ...(window as unknown as { __lph: { lcp: number; cls: number; tbt: number } }).__lph, nodes: document.getElementsByTagName("*").length }));
        await Promise.all(sizes);
        return { requests, transferBytes: transfer, domNodes: lab.nodes, lcpMs: Math.round(lab.lcp), cls: Math.round(lab.cls * 1000) / 1000, tbtMs: Math.round(lab.tbt) };
      } finally {
        await close(context);
      }
    },

    async close() {
      if (!opts.browser) await browser.close();
    },
  };
}
