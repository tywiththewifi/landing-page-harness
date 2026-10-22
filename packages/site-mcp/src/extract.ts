import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import type { Page, PageType } from "./types.ts";

const DROP = [
  "script", "style", "noscript", "template", "svg", "canvas", "iframe", "form",
  "nav", "dialog", "[role=dialog]", "[aria-hidden=true]", "[hidden]",
  // Mobile-only duplicates of desktop text (Tailwind and similar).
  "[class*='md:hidden']", "[class*='lg:hidden']", "[class*='sm:hidden']",
  // Cookie banners.
  "#CybotCookiebotDialog", "[id*=cookie i]", "[class*=cookie i]",
].join(",");

const BLOCK = new Set([
  "p", "div", "section", "article", "main", "aside", "ul", "ol", "li", "blockquote",
  "h1", "h2", "h3", "h4", "h5", "h6", "table", "thead", "tbody", "tr", "td", "th",
  "figure", "figcaption", "dl", "dt", "dd", "pre", "hr",
]);

export interface ExtractOptions {
  /** Paths linked from the site's header navigation, used to spot product pages. */
  navPaths?: Set<string>;
  lastModified?: string;
}

export function extractPage(html: string, url: string, opts: ExtractOptions = {}): Page {
  const $ = cheerio.load(html);
  const u = new URL(url);

  const meta = (sel: string) => $(sel).attr("content")?.trim() ?? "";
  const title = cleanTitle($("title").first().text().trim() || meta("meta[property='og:title']"));
  const description = meta("meta[name=description]") || meta("meta[property='og:description']");
  const image = meta("meta[property='og:image']") || undefined;
  const lang = ($("html").attr("lang") ?? "").split("-")[0] || langFromPath(u.pathname) || "en";

  const jsonLd: unknown[] = [];
  $("script[type='application/ld+json']").each((_, el) => {
    try {
      jsonLd.push(JSON.parse($(el).text()));
    } catch {
      // Ignore malformed blocks; some sites ship invalid JSON-LD.
    }
  });

  const root = $("main").first().length ? $("main").first() : $("article").first().length ? $("article").first() : $("body");
  root.find(DROP).remove();
  // The site's own header and footer: anything that links home or holds a
  // button bar. Some sites render them inside <main>.
  root.find("header, footer").each((_, el) => {
    const $el = $(el);
    if (root.is("body") || $el.find("a[href='/'], button").length || $el.css("position") === "fixed" || /\b(fixed|sticky)\b/.test($el.attr("class") ?? "")) {
      $el.remove();
    }
  });

  root.find("br").replaceWith(" ");

  const blocks: string[] = [];
  walk($, root.get(0)!, blocks);
  const lines = dedupe(blocks);

  const links = new Set<string>();
  root.find("a[href]").each((_, a) => {
    try {
      const href = new URL($(a).attr("href")!, url);
      if (href.origin === u.origin) links.add(normalizePath(href.pathname));
    } catch {
      // Unparseable href.
    }
  });

  const path = normalizePath(u.pathname);
  return {
    url: u.origin + path,
    path,
    type: classify(path, opts.navPaths),
    lang,
    title,
    description,
    image,
    outline: lines.filter((l) => l.startsWith("#")),
    markdown: lines.join("\n\n"),
    stats: findStats(lines),
    links: [...links],
    jsonLd,
    lastModified: opts.lastModified,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Pages the home page points at: header navigation plus links in the home
 * page's content. Used to tell product pages apart from other one-off pages.
 */
export function navPaths(html: string, url: string): Set<string> {
  const $ = cheerio.load(html);
  const out = new Set<string>();
  $("header a[href], nav a[href], main a[href]").each((_, a) => {
    try {
      const href = new URL($(a).attr("href")!, url);
      if (href.origin === new URL(url).origin) out.add(normalizePath(href.pathname));
    } catch {
      // Unparseable href.
    }
  });
  return out;
}

function walk($: cheerio.CheerioAPI, node: AnyNode, out: string[]): void {
  let inline = "";
  const flush = () => {
    const t = squash(inline);
    if (t) out.push(t);
    inline = "";
  };
  for (const child of (node as Element).children ?? []) {
    if (child.type === "text") {
      inline += (child as unknown as { data: string }).data;
      continue;
    }
    if (child.type !== "tag") continue;
    const el = child as Element;
    const tag = el.tagName.toLowerCase();
    if (!BLOCK.has(tag)) {
      if (tag === "img") continue;
      inline += " " + $(el).text() + " ";
      continue;
    }
    flush();
    const text = squash($(el).text());
    if (/^h[1-6]$/.test(tag)) {
      if (text) out.push(`${"#".repeat(Number(tag[1]))} ${text}`);
    } else if (tag === "li") {
      if (text) out.push(`- ${text}`);
    } else if (tag === "blockquote") {
      if (text) out.push(`> ${text}`);
    } else if (tag === "tr") {
      const cells = $(el).children("td,th").map((_, c) => squash($(c).text())).get();
      if (cells.some(Boolean)) out.push(`| ${cells.join(" | ")} |`);
    } else if (tag === "p" || tag === "figcaption" || tag === "dt" || tag === "dd" || tag === "pre") {
      if (text) out.push(text);
    } else {
      walk($, el, out);
    }
  }
  flush();
}

function dedupe(lines: string[]): string[] {
  const out: string[] = [];
  for (const l of lines) if (l !== out[out.length - 1]) out.push(l);
  return out;
}

function findStats(lines: string[]): string[] {
  const stats: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const bare = lines[i]!.replace(/^#+\s*/, "");
    if (bare.length <= 14 && /\d/.test(bare) && /^[^a-z]*[\d.,]+\s*(%|x|k|m|bn|\+|million|billion)?[^a-z]*$/i.test(bare)) {
      const next = lines[i + 1]?.replace(/^#+\s*/, "") ?? "";
      stats.push(next ? `${bare}: ${next.slice(0, 160)}` : bare);
    }
  }
  return stats;
}

const RULES: [RegExp, PageType][] = [
  [/(^|\/)(case-stud(y|ies)|customers?|success-stories)(\/|$)/i, "case-study"],
  [/(^|\/)(press(-releases)?|newsroom|news|media)(\/|$)/i, "press"],
  [/(^|\/)(blog|articles?|insights|resources|guides|posts?)(\/|$)/i, "article"],
  [/(^|\/)(events?|webinars?)(\/|$)/i, "event"],
  [/(^|\/)(marketplace|integrations?|apps|partners?)(\/|$)/i, "integration"],
  [/(^|\/)(careers?|jobs|working-at[\w-]*)(\/|$)/i, "careers"],
  [/(^|\/)(legal|privacy[\w-]*|terms[\w-]*|cookies?[\w-]*|security|compliance)(\/|$)/i, "legal"],
  [/(^|\/)(contact[\w-]*|request-a-demo|demo|book-a-demo)(\/|$)/i, "contact"],
  [/(^|\/)(products?|platform|solutions?|features?|pricing)(\/|$)/i, "product"],
];

export function classify(path: string, nav?: Set<string>): PageType {
  const bare = path.replace(/^\/[a-z]{2}(-[a-z]{2})?(?=\/|$)/i, "") || "/";
  if (bare === "/") return "home";
  for (const [re, type] of RULES) if (re.test(bare)) return type;
  if (nav?.has(path)) return "product";
  return "page";
}

export function normalizePath(p: string): string {
  const s = p.replace(/\/+$/, "");
  return s === "" ? "/" : s;
}

function langFromPath(p: string): string | undefined {
  return /^\/([a-z]{2})(\/|$)/.exec(p)?.[1];
}

function cleanTitle(t: string): string {
  // "Page | Brand | Brand" -> "Page | Brand"
  const parts = t.split(/\s+[|–—-]\s+/);
  return parts.filter((p, i) => parts.indexOf(p) === i).join(" | ");
}

function squash(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
