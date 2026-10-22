import type { Brand } from "@lph/tokens";
import { describe, inlineCss } from "./dom.ts";
import type { GateIssue, Severity } from "./types.ts";

const GENERIC_FONTS = /^(system-ui|-apple-system|blinkmacsystemfont|ui-sans-serif|ui-serif|ui-monospace|sans-serif|serif|monospace|cursive|fantasy|inherit|arial|helvetica|helvetica neue|georgia|times|times new roman|verdana|tahoma|trebuchet ms|segoe ui|roboto)$/i;

/** The first family in a font stack, unquoted. */
const family = (stack: string) => stack.split(",")[0]!.trim().replace(/^["']|["']$/g, "");

/**
 * Brand checks on the HTML as it will be published: everything is styled through the
 * brand's tokens and component classes, nothing bypasses them with inline styles, and
 * the brand's fonts and logo actually load. Without a brand (in a site repo's CI), only
 * the checks that need none run.
 */
export function brandLint(doc: Document, path: string, brand?: Brand): GateIssue[] {
  const issues: GateIssue[] = [];
  const add = (severity: Severity, id: string, message: string, extra: Partial<GateIssue> = {}) =>
    issues.push({ id: `brand.${id}`, check: "brand", severity, message, path, ...extra });
  const css = inlineCss(doc);

  // Inline styles and <font>-era attributes skip the tokens entirely. The logo's own SVG is the brand's.
  const styled = Array.from(doc.body.querySelectorAll("[style], font, [bgcolor], [color]")).filter((el) => !el.closest("svg"));
  if (styled.length) {
    add("error", "inline-style", `${styled.length === 1 ? "An element is" : `${styled.length} elements are`} styled inline instead of through the brand's tokens.`, {
      nodes: styled.slice(0, 5).map(describe),
    });
  }

  // Tokens the components use have to be defined by the brand.
  const defined = new Set(Array.from(css.matchAll(/(--[a-z0-9_-]+)\s*:/gi), (m) => m[1]!));
  const fallbacks = new Map<string, boolean>();
  for (const m of css.matchAll(/var\(\s*(--[a-z0-9_-]+)\s*(,)?/gi)) {
    const name = m[1]!;
    if (!defined.has(name) && /^--(color|font)-/.test(name)) fallbacks.set(name, (fallbacks.get(name) ?? false) || !!m[2]);
  }
  const missing = [...fallbacks].filter(([, hasFallback]) => !hasFallback).map(([n]) => n);
  const defaulted = [...fallbacks].filter(([, hasFallback]) => hasFallback).map(([n]) => n);
  if (missing.length) add("error", "token-missing", `The components use tokens the brand doesn't define, so those parts render unstyled: ${missing.join(", ")}.`);
  if (defaulted.length) add("warning", "token-default", `The brand doesn't define ${defaulted.join(", ")}, so the components use their built-in defaults. Set ${defaulted.length === 1 ? "it" : "them"} in the brand's Theme tab.`);

  // Button and card variants come from the brand's measured styles.
  const used = (prefix: string) =>
    new Set(
      Array.from(doc.body.querySelectorAll(`[class*="${prefix}--"]`)).flatMap((el) =>
        (el.getAttribute("class") ?? "").split(/\s+/).filter((c) => c.startsWith(`${prefix}--`)),
      ),
    );
  for (const [prefix, what] of [["lph-button", "button"], ["lph-card", "card"]] as const) {
    const undefinedStyles = [...used(prefix)].filter((cls) => !new RegExp(`\\.${cls.replace(/[-]/g, "\\-")}(?![\\w-])`).test(css));
    if (undefinedStyles.length) add("error", `${what}-style`, `${undefinedStyles.length === 1 ? `A ${what} uses a style` : `${what[0]!.toUpperCase()}${what.slice(1)}s use styles`} the brand doesn't have: ${undefinedStyles.map((c) => c.slice(prefix.length + 2)).join(", ")}.`);
  }

  if (!brand) return issues;

  // The brand's fonts load, or visitors see a fallback.
  const links = Array.from(doc.querySelectorAll('link[rel="stylesheet"]')).map((l) => decodeURIComponent(l.getAttribute("href") ?? "").replace(/\+/g, " "));
  for (const [role, stack] of [["heading", brand.fonts.heading], ["body", brand.fonts.body]] as const) {
    const name = family(stack);
    if (!name || GENERIC_FONTS.test(name)) continue;
    const faced = new RegExp(`font-family:\\s*["']?${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']?\\s*[;}]`, "i").test(css);
    const linked = links.some((href) => href.toLowerCase().includes(`family=${name.toLowerCase()}`));
    if (!faced && !linked) add("warning", `font-${role}`, `The ${role} font, ${name}, isn't loaded on the page, so visitors see a fallback. Add its web font to the brand.`);
  }

  // The header carries the logo.
  const logo = doc.querySelector(".lph-nav__logo");
  if (logo && !logo.querySelector("svg, img")) add("info", "logo", `The header shows "${logo.textContent?.trim()}" as text. Add the logo in the brand's Theme tab.`);
  return issues;
}
