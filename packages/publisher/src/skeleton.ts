/** Attributes that hold copy: changing them is a copy edit. */
const COPY_ATTRS = new Set(["alt", "title", "aria-label", "placeholder", "data-success"]);
/** Meta tags whose content is copy. Every other meta's content (robots, viewport, og:url…) is kept. */
const COPY_META = /^(description|og:title|og:description|twitter:title|twitter:description)$/i;
/** JSON-LD keys whose strings point somewhere rather than say something. */
const LD_KEPT = new Set(["@context", "@type", "@id", "url", "sameAs", "logo", "image", "inLanguage"]);

function ldShape(value: unknown, key = ""): unknown {
  if (typeof value === "string") return LD_KEPT.has(key) ? value : "";
  if (Array.isArray(value)) return value.map((v) => ldShape(v, key));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, ldShape(v, k)]));
  return value;
}

/**
 * A page's HTML with its words taken out: every tag with its attributes, and what its
 * scripts and styles contain. A copy edit leaves it as it was; a new link, script,
 * element or class doesn't. The site's CI compares it before and after, so an HTML file
 * edited by hand can't pass as a copy change.
 *
 * It reads the HTML as a sequence of tags rather than parsing it: anything unusual in a
 * hand edit (a stray `<`, a broken attribute) makes it differ, which sends the change to
 * a reviewer.
 */
export function htmlSkeleton(html: string): string {
  const out: string[] = [];
  const tag = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(html))) {
    if (m[0].startsWith("<!--")) {
      out.push(m[0]);
      continue;
    }
    const [, close, rawName, rest] = m as unknown as [string, string, string, string];
    const name = rawName.toLowerCase();
    const attrs = [...rest.matchAll(/([^\s"'=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)].map((a) => [a[1]!.toLowerCase(), a[2] ?? a[3] ?? a[4] ?? null] as const);
    const metaName = name === "meta" ? (attrs.find(([k]) => k === "name" || k === "property")?.[1] ?? "") : "";
    const kept = attrs.filter(([k]) => !COPY_ATTRS.has(k) && !(k === "content" && COPY_META.test(metaName)));
    out.push(`<${close}${name}${kept.map(([k, v]) => (v === null ? ` ${k}` : ` ${k}="${v}"`)).join("")}>`);

    // Scripts and styles are kept whole, apart from JSON-LD's text, which is the page's copy again.
    if (!close && (name === "script" || name === "style")) {
      const end = html.toLowerCase().indexOf(`</${name}`, tag.lastIndex);
      const body = html.slice(tag.lastIndex, end < 0 ? undefined : end);
      const ld = name === "script" && kept.some(([k, v]) => k === "type" && /ld\+json/i.test(v ?? ""));
      if (ld) {
        try {
          out.push(JSON.stringify(ldShape(JSON.parse(body))));
        } catch {
          out.push(body);
        }
      } else out.push(body);
      tag.lastIndex = end < 0 ? html.length : end;
    }
  }
  return out.join("");
}

/** True when two versions of a page's HTML differ in more than their words. */
export const beyondCopy = (before: string, after: string) => htmlSkeleton(before) !== htmlSkeleton(after);
