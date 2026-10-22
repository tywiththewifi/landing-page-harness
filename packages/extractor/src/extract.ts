import { chromium, type Browser, type Page } from "playwright";
import type { Brand } from "@lph/tokens";
import { analyze, type PageCapture } from "./analyze.ts";
import { collectPage, type PageSample } from "./collect.ts";

export interface ExtractOptions {
  url: string;
  /** Main product page. Discovered from the home page navigation when omitted. */
  productUrl?: string;
  /** Reuse a browser (tests, servers). One is launched and closed otherwise. */
  browser?: Browser;
  onProgress?: (step: string) => void;
  timeoutMs?: number;
}

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

const PRODUCT_HINT = /\b(product|platform|features?|solutions?|how[- ]it[- ]works|overview|tour|why)\b/i;
const NOT_PRODUCT =
  /\b(pricing|plans|blog|news|about|careers|jobs|contact|login|log-in|sign[- ]?in|sign[- ]?up|register|legal|privacy|terms|docs|help|support|status|press|cookie|demo|start|trial)\b/i;

/** Picks the most likely "main product page" from header links. */
export function pickProductPage(links: PageSample["navLinks"], homeUrl: string): string | null {
  const home = new URL(homeUrl);
  const seen = new Set<string>();
  const scored = links
    .map((l) => {
      let u: URL;
      try {
        u = new URL(l.href, homeUrl);
      } catch {
        return null;
      }
      u.hash = "";
      if (u.origin !== home.origin || u.pathname === home.pathname || u.pathname === "/") return null;
      if (seen.has(u.href)) return null;
      seen.add(u.href);
      const hay = `${l.text} ${u.pathname}`;
      if (NOT_PRODUCT.test(hay)) return { href: u.href, score: -1 };
      const depth = u.pathname.split("/").filter(Boolean).length;
      return { href: u.href, score: (PRODUCT_HINT.test(hay) ? 10 : 1) - depth };
    })
    .filter((x): x is { href: string; score: number } => !!x && x.score > -1)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.href ?? null;
}

async function capture(page: Page, url: string, timeoutMs: number): Promise<PageSample> {
  await page.goto(url, { waitUntil: "load", timeout: timeoutMs });
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  // Trigger lazy-loaded sections, then return to the top.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
  });
  return page.evaluate(collectPage);
}

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    headless: true,
    executablePath: process.env.LPH_CHROMIUM_PATH || undefined,
  });
}

export async function capturePages(opts: ExtractOptions): Promise<PageCapture[]> {
  const timeoutMs = opts.timeoutMs ?? 30000;
  const progress = opts.onProgress ?? (() => {});
  const browser = opts.browser ?? (await launchBrowser());
  try {
    const context = await browser.newContext({ viewport: DESKTOP, userAgent: undefined });
    // Bundlers (tsx/esbuild) can wrap functions with a __name helper that doesn't exist in the page.
    await context.addInitScript("window.__name = (f) => f;");
    const page = await context.newPage();

    progress("Reading the home page");
    const home = await capture(page, opts.url, timeoutMs);
    const productUrl = opts.productUrl ?? pickProductPage(home.navLinks, home.url);
    const urls = [home.url, ...(productUrl ? [productUrl] : [])];

    const captures: PageCapture[] = [{ desktop: home }];
    if (productUrl) {
      progress(`Reading the product page (${new URL(productUrl).pathname})`);
      captures.push({ desktop: await capture(page, productUrl, timeoutMs) });
    }

    progress("Checking mobile type sizes");
    await page.setViewportSize(MOBILE);
    for (const [i, url] of urls.entries()) {
      captures[i]!.mobile = await capture(page, url, timeoutMs);
    }
    await context.close();
    return captures;
  } finally {
    if (!opts.browser) await browser.close();
  }
}

export function brandId(url: string): string {
  const host = new URL(url).hostname.replace(/^www\./, "").replace(/[^a-z0-9]+/gi, "-");
  return `${host}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Samples the home page and the main product page and returns the measured brand. */
export async function extractBrand(opts: ExtractOptions): Promise<Brand> {
  const captures = await capturePages(opts);
  opts.onProgress?.("Building the design system");
  return analyze(captures, { id: brandId(captures[0]!.desktop.url) });
}
