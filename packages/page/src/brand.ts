import { contrastRatio, normalizeColor, semanticColors, type Brand, type ButtonStyle } from "@lph/tokens";
import type { Tone } from "./schema.ts";

/**
 * Which of the brand's buttons to use on a band. Sites style buttons for the background
 * they sit on (a white button on the green hero, a green one on white), so the page
 * picks per band instead of asking anyone to: buttons measured on that background
 * first, then any that stay visible on it.
 */
/** "hero" is a hero left on its automatic band; pass heroTone(brand, block.tone) for a hero block. */
export function buttonsFor(brand: Brand, tone: Tone | "hero"): { primary: string; secondary: string; visible: boolean } {
  const sem = semanticColors(brand);
  const band = tone === "hero" ? heroTone(brand) : tone;
  const bg = band === "brand" ? sem.brand : band === "subtle" ? sem.subtle : sem.surface;
  const edge = (b: ButtonStyle) => (b.kind === "filled" ? b.background : b.borderColor) ?? b.color;
  const visible = (b: ButtonStyle) =>
    // Labels need WCAG AA's 4.5:1 to pass the publish checks, or 3:1 when they're large text.
    b.kind === "text" ? contrastRatio(b.color, bg) >= labelMin(b) : contrastRatio(edge(b), bg) >= 1.4 && contrastRatio(b.color, b.background ?? bg) >= labelMin(b);
  const here = (b: ButtonStyle) => (band === "subtle" ? b.context === sem.surface || b.context === bg : b.context === bg);

  const boxed = brand.buttons.filter((b) => b.kind !== "text" && visible(b));
  const ranked = [...boxed.filter(here), ...boxed.filter((b) => !here(b))];
  const link = brand.buttons.find((b) => b.kind === "text" && visible(b));
  const primary = ranked.find((b) => b.kind === "filled") ?? ranked[0];
  // Two buttons that look the same read as one choice (Bolt Pharmacy styles two identical blues),
  // so the second one has to look different, or fall back to the text link.
  const look = (b: ButtonStyle) => [b.kind, b.background, b.borderColor, b.color].join("|");
  const secondary = ranked.find((b) => b !== primary && (!primary || look(b) !== look(primary))) ?? link ?? ranked.find((b) => b !== primary);
  return {
    primary: primary?.name ?? brand.buttons[0]?.name ?? "primary",
    secondary: secondary?.name ?? "link",
    visible: !!primary || !brand.buttons.length,
  };
}

/** WCAG's large text: 24px, or 18.66px (14pt) bold. Large labels need 3:1 instead of 4.5:1. */
const labelMin = (b: ButtonStyle) => (b.fontSize >= 24 || (b.fontSize >= 18.66 && b.fontWeight >= 700) ? 3 : 4.5);

/**
 * The hero's band. It sits on the brand colour unless a person chose the subtle band, or
 * none of the brand's buttons would stand out on the brand colour, as when the brand colour
 * is the button colour (Genki's red). Then it takes the subtle band, as such sites do.
 */
export const heroTone = (brand: Brand, tone?: Tone): "brand" | "subtle" =>
  tone === "subtle" || (brand.buttons.length && !buttonsFor(brand, "brand").visible) ? "subtle" : "brand";

/**
 * Match where the site puts its header: a logo drawn in the brand colour vanishes on a brand
 * band. A logo drawn for a dark header (SCAYLE's white and mint wordmark) vanishes on the page
 * background, so it takes the brand band when it shows up better there.
 */
export function navTone(brand: Brand): "brand" | "surface" {
  const sem = semanticColors(brand);
  const inks = logoColors(brand);
  const worst = (bg: string) => Math.min(...inks.map((c) => contrastRatio(c, bg)));
  if (inks.length && worst(sem.surface) < 1.5 && worst(sem.brand) > worst(sem.surface)) return "brand";
  return brand.colors.find((c) => c.role === "brand")?.usage.includes("navigation") ? "brand" : "surface";
}

/** The colours an SVG logo paints with. currentColor follows the header, so it doesn't count. */
const logoColors = (brand: Brand): string[] =>
  brand.logo?.kind === "svg" && brand.logo.svg
    ? [...new Set([...brand.logo.svg.matchAll(/\b(?:fill|stroke)(?:="|:\s*)([^";]+)/g)].map((m) => normalizeColor(m[1])).filter((c): c is string => !!c))]
    : [];
