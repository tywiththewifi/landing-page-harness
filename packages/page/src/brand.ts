import { contrastRatio, semanticColors, type Brand, type ButtonStyle } from "@lph/tokens";
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
  const secondary = ranked.find((b) => b !== primary) ?? link;
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

/** Match where the site puts its header: a logo drawn in the brand colour vanishes on a brand band. */
export const navTone = (brand: Brand): "brand" | "surface" =>
  brand.colors.find((c) => c.role === "brand")?.usage.includes("navigation") ? "brand" : "surface";
