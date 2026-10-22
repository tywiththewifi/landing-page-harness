import * as cheerio from "cheerio";
import { extractPage, navPaths, normalizePath } from "./extract.ts";
import { parseRobots, type Robots } from "./robots.ts";
import type { Page, Snapshot } from "./types.ts";

export const DEFAULT_USER_AGENT = "lph-site-mcp/0.1 (+https://github.com/tywiththewifi/landing-page-harness)";

export interface CrawlOptions {
  url: string;
  maxPages?: number;
  /** Only crawl paths matching one of these prefixes, e.g. ["/case-studies"]. */
  include?: string[];
  /** Language prefixes to keep ("en" keeps unprefixed paths). Default: all. */
  langs?: string[];
  /** Polite delay between requests; raised to the site's Crawl-delay if larger. */
  delayMs?: number;
  concurrency?: number;
  userAgent?: string;
  /** Called before every fetch; throw to refuse a URL (SSRF guard). */
  guard?: (url: string) => Promise<unknown>;
  fetch?: typeof fetch;
  onProgress?: (message: string) => void;
}

/**
 * Crawl a site politely into a snapshot: robots.txt first, then the sitemap
 * (or links from the home page when there is none), one host only.
 */
export async function crawlSite(opts: CrawlOptions): Promise<Snapshot> {
  const doFetch = opts.fetch ?? fetch;
  const ua = opts.userAgent ?? DEFAULT_USER_AGENT;
  const origin = new URL(opts.url).origin;
  const max = opts.maxPages ?? 300;
  const log = opts.onProgress ?? (() => {});
  const skipped: Snapshot["skipped"] = [];

  const get = async (url: string, accept = "text/html") => {
    await opts.guard?.(url);
    const res = await doFetch(url, { headers: { "user-agent": ua, accept }, redirect: "follow" });
    return res;
  };

  const robotsRes = await get(`${origin}/robots.txt`, "text/plain").catch(() => undefined);
  const robots: Robots = parseRobots(robotsRes?.ok ? await robotsRes.text() : "", ua);
  const delay = Math.max(opts.delayMs ?? 500, robots.crawlDelayMs ?? 0);
  log(`robots.txt: ${robotsRes?.ok ? "found" : "none"}, delay ${delay}ms`);

  const homeRes = await get(origin + "/");
  const homeHtml = await homeRes.text();
  const nav = navPaths(homeHtml, origin + "/");

  const lastmod = new Map<string, string>();
  let urls = await readSitemaps(robots.sitemaps.length ? robots.sitemaps : [`${origin}/sitemap.xml`], get, lastmod, origin);
  log(`sitemap: ${urls.length} URLs`);
  if (urls.length === 0) {
    urls = [origin + "/", ...[...nav, ...linksFrom(homeHtml, origin)].map((p) => origin + p)];
  }

  const seen = new Set<string>();
  const queue: string[] = [];
  for (const raw of urls) {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    if (u.origin !== origin) continue;
    const path = normalizePath(u.pathname);
    if (seen.has(path)) continue;
    seen.add(path);
    if (opts.include && !opts.include.some((p) => path === p || path.startsWith(p.replace(/\/$/, "") + "/") || (p === "/" && path === "/"))) continue;
    if (opts.langs && !opts.langs.includes(pathLang(path))) continue;
    if (!robots.allows(path)) {
      skipped.push({ url: origin + path, reason: "robots.txt" });
      continue;
    }
    queue.push(origin + path);
  }
  if (queue.length > max) {
    skipped.push(...queue.slice(max).map((url) => ({ url, reason: "max pages" })));
    queue.length = max;
  }

  const pages: Page[] = [];
  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      const url = queue[next++]!;
      try {
        const html = url === origin + "/" ? homeHtml : await (async () => {
          const res = await get(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          if (!(res.headers.get("content-type") ?? "").includes("html")) throw new Error("not HTML");
          return res.text();
        })();
        if (/<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(html)) {
          skipped.push({ url, reason: "noindex" });
        } else {
          pages.push(extractPage(html, url, { navPaths: nav, lastModified: lastmod.get(new URL(url).pathname) }));
        }
        log(`${pages.length}/${queue.length} ${url}`);
      } catch (err) {
        skipped.push({ url, reason: (err as Error).message });
      }
      await new Promise((r) => setTimeout(r, delay));
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency ?? 2 }, worker));

  pages.sort((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path));
  // Translated sections that still serve the original text (e.g. /ja/about
  // in English) would double every search hit; keep the shortest path.
  const byBody = new Map<string, string>();
  const unique = pages.filter((p) => {
    const first = byBody.get(p.markdown);
    if (first && p.markdown.length > 200) {
      skipped.push({ url: p.url, reason: `duplicate of ${first}` });
      return false;
    }
    byBody.set(p.markdown, p.path);
    return true;
  });
  unique.sort((a, b) => a.path.localeCompare(b.path));
  const home = unique.find((p) => p.path === "/");
  return {
    version: 1,
    origin,
    name: siteName(homeHtml, home?.title) || new URL(origin).hostname,
    crawledAt: new Date().toISOString(),
    userAgent: ua,
    skipped,
    pages: unique,
  };
}

async function readSitemaps(
  roots: string[],
  get: (url: string, accept?: string) => Promise<Response>,
  lastmod: Map<string, string>,
  origin: string,
): Promise<string[]> {
  const out: string[] = [];
  const pending = [...roots];
  const done = new Set<string>();
  while (pending.length && done.size < 50) {
    const sm = pending.shift()!;
    if (done.has(sm)) continue;
    done.add(sm);
    const res = await get(sm, "application/xml").catch(() => undefined);
    if (!res?.ok) continue;
    const $ = cheerio.load(await res.text(), { xml: true });
    $("sitemap > loc").each((_, el) => {
      pending.push($(el).text().trim());
    });
    $("url").each((_, el) => {
      const loc = $(el).find("loc").first().text().trim();
      if (!loc) return;
      out.push(loc);
      const mod = $(el).find("lastmod").first().text().trim();
      try {
        const u = new URL(loc);
        if (mod && u.origin === origin) lastmod.set(normalizePath(u.pathname), mod);
      } catch {
        // Ignore bad <loc>.
      }
    });
  }
  return out;
}

function linksFrom(html: string, origin: string): string[] {
  const $ = cheerio.load(html);
  const out: string[] = [];
  $("a[href]").each((_, a) => {
    try {
      const u = new URL($(a).attr("href")!, origin);
      if (u.origin === origin) out.push(normalizePath(u.pathname));
    } catch {
      // Unparseable href.
    }
  });
  return out;
}

function pathLang(path: string): string {
  return /^\/([a-z]{2})(\/|$)/.exec(path)?.[1] ?? "en";
}

/** The brand, not the home page's tagline: "Acme: We do X | Acme" -> "Acme". */
function siteName(html: string, homeTitle = ""): string {
  const $ = cheerio.load(html);
  const og = $("meta[property='og:site_name']").attr("content")?.trim() ?? "";
  const fromTitle = homeTitle.split(" | ").pop()?.trim() ?? "";
  const candidates = [og, fromTitle].map((s) => s.split(/\s*[:|–—]\s+/)[0]!.trim()).filter(Boolean);
  return candidates.sort((a, b) => a.length - b.length)[0] ?? "";
}
