import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { Brand } from "@lph/tokens";
import { analyze, type PageCapture } from "./analyze.ts";
import { collectPage, removeOverlays, type PageSample } from "./collect.ts";

export interface ExtractOptions {
  url: string;
  /** Main product page. Discovered from the home page navigation when omitted. */
  productUrl?: string;
  /** Reuse a browser (tests, servers). One is launched and closed otherwise. */
  browser?: Browser;
  onProgress?: (step: string) => void;
  timeoutMs?: number;
  /**
   * For a public service: every address the browser talks to is checked with this, and
   * the import fails if one is refused (an internal address, say). Hosts are resolved
   * before each request, and redirects are caught from the address that answered.
   */
  allowAddress?: (ip: string) => boolean;
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

/**
 * Bot checks (Cloudflare, DataDome, PerimeterX, Akamai and the like) that stand in for the
 * site. Measuring one would give a brand made of the check's colours, so the import stops.
 */
const BOT_CHECKS: [string, RegExp][] = [
  ["Cloudflare", /^(just a moment|attention required|one more step)\b|cloudflare ray id|cf-chl|challenges\.cloudflare\.com/i],
  ["DataDome", /captcha-delivery\.com|datadome/i],
  ["PerimeterX", /px-captcha|perimeterx/i],
  ["Akamai", /^access denied$|reference #\d+\.[0-9a-f]+/i],
  ["a bot check", /checking (if the site connection is secure|your browser)|verify(ing)? (that )?you are (a )?human|are you a robot/i],
];

export class BlockedByBotCheck extends Error {}

/** Which bot check the page is, if it is one. */
export async function botCheck(page: Page): Promise<string | null> {
  const probe = await page
    .evaluate(() => {
      const scripts = [...document.querySelectorAll("script[src], iframe[src]")].map((e) => e.getAttribute("src")).join(" ");
      return { title: document.title.trim(), text: (document.body?.innerText ?? "").slice(0, 2000), scripts, size: document.body?.querySelectorAll("*").length ?? 0 };
    })
    .catch(() => null);
  if (!probe) return null;
  // A real page can mention a bot check in passing; a check page is small and says little else.
  if (probe.size > 400) return null;
  const hay = `${probe.title}\n${probe.text}\n${probe.scripts}`;
  return BOT_CHECKS.find(([, re]) => re.test(probe.title) || re.test(hay))?.[0] ?? null;
}

async function capture(page: Page, url: string, timeoutMs: number): Promise<PageSample> {
  await page.goto(url, { waitUntil: "load", timeout: timeoutMs }).catch(async (err: unknown) => {
    // The previous page's scripts can cancel the next navigation (GoodHabitz does on the
    // second visit to its home page); trying once more gets through.
    if (!String(err).includes("net::ERR_ABORTED")) throw err;
    await page.goto(url, { waitUntil: "load", timeout: timeoutMs });
  });
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  // Some checks pass by themselves after a few seconds and reload the page.
  for (let i = 0; i < 4 && (await botCheck(page)); i++) {
    await page.waitForTimeout(2500);
    await page.waitForLoadState("load").catch(() => {});
  }
  const check = await botCheck(page);
  if (check) {
    throw new BlockedByBotCheck(
      `${new URL(url).hostname} showed ${check === "a bot check" ? check : `a ${check} bot check`} instead of the page, so it can't be measured. Sites that block automated browsers need importing from a browser that has passed the check.`,
    );
  }
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.evaluate(removeOverlays).catch(() => 0);
  // Trigger lazy-loaded sections, then return to the top.
  // "instant" overrides `scroll-behavior: smooth`, which would otherwise leave the page
  // part-way down when sampling starts (and the header measured off-screen).
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight) {
      window.scrollTo({ top: y, behavior: "instant" });
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  // Consent banners can appear after a delay or on scroll.
  await page.evaluate(removeOverlays).catch(() => 0);
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
  let context: BrowserContext | undefined;
  let guard: NetworkGuard | null = null;
  try {
    // Service workers fetch outside the guard's reach, so they're off when it's on.
    context = await browser.newContext({ viewport: DESKTOP, userAgent: undefined, serviceWorkers: opts.allowAddress ? "block" : "allow" });
    guard = opts.allowAddress ? await guardNetwork(context, opts.allowAddress) : null;
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
    await guard?.check();
    return captures;
  } catch (err) {
    // A refused address explains the failure better than the browser's error does.
    await guard?.check();
    throw err;
  } finally {
    // A shared browser outlives the import, so its context is closed even on failure.
    await context?.close().catch(() => {});
    if (!opts.browser) await browser.close();
  }
}

interface NetworkGuard {
  check: () => Promise<void>;
}

/** See ExtractOptions.allowAddress. */
async function guardNetwork(context: BrowserContext, allow: (ip: string) => boolean): Promise<NetworkGuard> {
  let refused: string | null = null;
  const pending: Promise<void>[] = [];
  const resolved = new Map<string, Promise<string[]>>();
  // A host that doesn't resolve here won't load in the browser either.
  const addresses = (host: string) => {
    if (isIP(host)) return Promise.resolve([host]);
    if (!resolved.has(host)) resolved.set(host, lookup(host, { all: true }).then((all) => all.map((a) => a.address), () => []));
    return resolved.get(host)!;
  };

  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (/^(https?|wss?):$/.test(url.protocol) && (await addresses(host)).some((a) => !allow(a))) {
      refused ??= url.hostname;
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  context.on("response", (res) => {
    pending.push(
      res
        .serverAddr()
        .then((addr) => {
          if (addr && !allow(addr.ipAddress)) refused ??= new URL(res.url()).hostname;
        })
        .catch(() => {}),
    );
  });

  return {
    async check() {
      await Promise.all(pending);
      if (refused) throw new Error(`The page tried to load from ${refused}, an internal address, so it can't be imported.`);
    },
  };
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
