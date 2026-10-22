/** Small DOM helpers that work the same on a browser Document and on linkedom's. */

const SKIP = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "SVG"]);

/** The text a visitor can read: everything in <body> but scripts, styles and hidden elements. */
export function visibleText(root: Element | null | undefined): string {
  if (!root) return "";
  const out: string[] = [];
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) out.push(child.textContent ?? "");
      else if (child.nodeType === 1) {
        const el = child as Element;
        if (SKIP.has(el.tagName.toUpperCase()) || el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true") continue;
        // The honeypot is off-screen and labelled for bots, not visitors.
        if (el.classList?.contains("lph-hp")) continue;
        walk(el);
      }
    }
  };
  walk(root);
  return out.join(" ").replace(/\s+/g, " ").trim();
}

export const normalise = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const wordsIn = (s: string) => normalise(s).split(" ").filter(Boolean);

/** How much of `a`'s vocabulary `b` shares, 0 to 1. Used to match a planned question to the one on the page. */
export function overlap(a: string, b: string): number {
  const wa = new Set(wordsIn(a));
  const wb = new Set(wordsIn(b));
  if (!wa.size) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / wa.size;
}

export const attr = (doc: Document, selector: string, name: string) => doc.querySelector(selector)?.getAttribute(name)?.trim() ?? "";

/** A short label for an element in a report: its tag, id and first class. */
export function describe(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.getAttribute("id");
  const cls = (el.getAttribute("class") ?? "").split(/\s+/).find(Boolean);
  return `${tag}${id ? `#${id}` : ""}${cls ? `.${cls}` : ""}`;
}

/** Every stylesheet the page carries inline. */
export const inlineCss = (doc: Document) =>
  Array.from(doc.querySelectorAll("style"))
    .map((s) => s.textContent ?? "")
    .join("\n");
