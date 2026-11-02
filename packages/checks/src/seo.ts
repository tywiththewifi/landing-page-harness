import { attr, normalise, overlap, visibleText, wordsIn } from "./dom.ts";
import type { GateIssue, Severity } from "./types.ts";

export interface SeoContext {
  /** The URL path this HTML is published at. */
  path: string;
  /** The general page, rather than a persona version. */
  general: boolean;
  /** "publish" checks what search engines will see; "preview" expects noindex and no canonical. */
  mode: "publish" | "preview";
  /** From the brief, when there is one. */
  keyword?: string;
  questions?: string[];
  /**
   * The page model was checked too (checkPage), so skip what it already covers with a
   * pointer to the field: title and meta lengths, and where buttons link.
   */
  modelChecked?: boolean;
}

const SLUG_PATH = /^(\/[a-z0-9]+(-[a-z0-9]+)*)+\/?$/;

type JsonLdNode = { "@type"?: string | string[]; [key: string]: unknown };

function jsonLdNodes(doc: Document): { nodes: JsonLdNode[]; broken: number } {
  const nodes: JsonLdNode[] = [];
  let broken = 0;
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const data = JSON.parse(script.textContent ?? "");
      const list = Array.isArray(data) ? data : [data];
      for (const item of list) {
        if (item && typeof item === "object") nodes.push(...(Array.isArray(item["@graph"]) ? item["@graph"] : [item]));
      }
    } catch {
      broken++;
    }
  }
  return { nodes, broken };
}

const typesOf = (n: JsonLdNode) => (Array.isArray(n["@type"]) ? n["@type"] : [n["@type"]]).filter(Boolean) as string[];

/**
 * Search and answer-engine checks on the HTML as it will be published: what a crawler
 * and an answer engine read, independent of how the page was made. Runs on a browser
 * Document or a linkedom one.
 */
export function seoLint(doc: Document, ctx: SeoContext): GateIssue[] {
  const issues: GateIssue[] = [];
  const add = (severity: Severity, id: string, message: string, extra: Partial<GateIssue> = {}) =>
    issues.push({ id: `seo.${id}`, check: "seo", severity, message, path: ctx.path, ...extra });
  const publish = ctx.mode === "publish";

  if (!doc.documentElement.getAttribute("lang")?.trim()) add("error", "lang", "The page doesn't say what language it's in (<html lang>). Search engines and screen readers need it.");
  if (!doc.querySelector('meta[name="viewport"]')) add("error", "viewport", "There's no viewport tag, so phones show the desktop layout zoomed out.");
  // React writes "charSet"; HTML attribute names aren't case-sensitive, but some parsers keep the case.
  if (!Array.from(doc.querySelectorAll("meta")).some((m) => m.hasAttribute("charset") || m.hasAttribute("charSet"))) add("warning", "charset", "There's no charset tag. Add <meta charset=\"utf-8\"> first in <head>.");

  const title = doc.querySelector("title")?.textContent?.trim() ?? "";
  const description = attr(doc, 'meta[name="description"]', "content");
  if (!title) add("error", "title", "The page has no title for search results.");
  else if (!ctx.modelChecked && (title.length < 30 || title.length > 60)) add("warning", "title-length", `The title in search results is ${title.length} characters long. Aim for 30 to 60 so it isn't cut off.`);
  if (!description) add("error", "description", "The page has no description for search results, so search engines will pick some text themselves.");
  else if (!ctx.modelChecked && (description.length < 120 || description.length > 160)) add("warning", "description-length", `The description in search results is ${description.length} characters long. Aim for 120 to 160.`);

  const h1s = Array.from(doc.querySelectorAll("h1"));
  if (h1s.length !== 1) add("error", "h1", h1s.length ? `The page has ${h1s.length} main headings. Use just one.` : "The page has no main heading.");
  else if (!h1s[0]!.textContent?.trim()) add("error", "h1", "The main heading is empty.");

  // What search engines are told about the URL.
  const robots = attr(doc, 'meta[name="robots"]', "content").toLowerCase();
  const canonical = attr(doc, 'link[rel="canonical"]', "href");
  if (publish) {
    if (robots.includes("noindex")) add("error", "noindex", "The page tells search engines to hide it. That's right for previews, but not for a published page.");
    if (!canonical) add("error", "canonical", "The page doesn't tell search engines its main address, so copies of it (like links with tracking codes) can compete with it in search.");
    else if (!/^https:\/\//.test(canonical)) add("error", "canonical", `The page's main address for search engines, "${canonical}", has to be a full address starting with https://.`);
    else if (ctx.general && new URL(canonical).pathname.replace(/\/$/, "") !== ctx.path.replace(/\/$/, "")) {
      add("warning", "canonical", `The general page tells search engines its main address is ${new URL(canonical).pathname}, not itself, so it won't show up in search.`);
    }
    if (!SLUG_PATH.test(ctx.path)) add("warning", "url", `${ctx.path} can't be used as a page address. Use lowercase words joined by hyphens.`);
    else if (ctx.path.length > 75) add("info", "url", `The page address is ${ctx.path.length} characters long. Shorter addresses are easier to share and read.`);
  }

  // How the link looks when shared.
  if (!attr(doc, 'meta[property="og:title"]', "content")) add("warning", "og-title", "There's no title for when the page is shared, so social sites will pick one themselves.");
  if (!attr(doc, 'meta[property="og:description"]', "content")) add("warning", "og-description", "There's no description for when the page is shared.");
  if (publish && !attr(doc, 'meta[property="og:url"]', "content")) add("warning", "og-url", "Shared links don't point to one main address, so shares of links with tracking codes are counted separately.");
  if (!attr(doc, 'meta[property="og:image"]', "content")) add("info", "og-image", "There's no picture for when the page is shared, so shared links show without one.");

  // Structured data has to parse, and has to describe what's on the page.
  const text = visibleText(doc.body);
  const pageText = normalise(text);
  const { nodes, broken } = jsonLdNodes(doc);
  if (broken) add("error", "json-ld", `${broken === 1 ? "Some information for search engines is" : `${broken} pieces of information for search engines are`} broken, so search engines ignore ${broken === 1 ? "it" : "them"}.`);
  const types = nodes.flatMap(typesOf);
  if (!types.includes("WebPage")) add("warning", "json-ld-webpage", "The page doesn't describe itself to search engines.");
  if (!types.includes("Organization")) add("info", "json-ld-organization", "The page doesn't tell search engines which company it belongs to.");
  for (const faq of nodes.filter((n) => typesOf(n).includes("FAQPage"))) {
    const entities = Array.isArray(faq.mainEntity) ? (faq.mainEntity as JsonLdNode[]) : [];
    const hidden = entities.map((q) => String(q.name ?? "")).filter((q) => q && !pageText.includes(normalise(q)));
    if (hidden.length) add("error", "faq-visible", `Search engines are told about questions that aren't on the page: ${hidden.map((q) => `"${q}"`).join(", ")}.`);
  }

  // Answer engines: the questions the brief planned to answer, answered where they can be quoted.
  const asked = Array.from(doc.querySelectorAll("summary, h2, h3, dt")).map((el) => el.textContent ?? "");
  for (const q of ctx.questions ?? []) {
    if (!q.trim()) continue;
    const found = pageText.includes(normalise(q)) || asked.some((a) => overlap(q, a) >= 0.75);
    if (!found) add("warning", "aeo-question", `The brief plans to answer "${q}", but the page doesn't ask it. AI search tools quote pages that ask a question and answer it directly.`);
  }

  // The keyword early on, where search engines and readers look first.
  const kw = ctx.keyword?.trim();
  if (kw && ctx.general) {
    const main = doc.querySelector("main") ?? doc.body;
    const opening = wordsIn(visibleText(main)).slice(0, 100).join(" ");
    if (!opening.includes(normalise(kw))) add("info", "keyword-opening", `"${kw}" isn't in the page's first 100 words.`);
  }
  const words = wordsIn(visibleText(doc.querySelector("main") ?? doc.body)).length;
  if (ctx.general && words < 250) add("info", "thin", `The page has ${words} words. Pages under about 250 words rarely rank well in search, which is fine for a campaign page.`);

  // Links a crawler follows. The page model checks the buttons it makes; this catches the rest.
  if (!ctx.modelChecked) {
    for (const a of Array.from(doc.querySelectorAll("a"))) {
      const href = a.getAttribute("href")?.trim() ?? "";
      const label = a.textContent?.trim() || a.getAttribute("aria-label") || href;
      if (!href || href === "#") add("error", "link", `"${label}" doesn't link anywhere.`);
      else if (/^javascript:/i.test(href)) add("error", "link", `"${label}" runs code instead of linking to a page.`);
      else if (href.startsWith("#") && !doc.getElementById(href.slice(1))) add("error", "link", `"${label}" links to ${href}, but there's no section with that name on the page.`);
      else if (href.startsWith("http://")) add("warning", "link", `"${label}" links to an address starting with http://. Use https:// so visitors don't see a security warning.`);
    }
  }
  return issues;
}
