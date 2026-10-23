import { contrastRatio, semanticColors, type Brand, type ButtonStyle } from "@lph/tokens";
import type { Tone } from "./schema.ts";

/**
 * Which of the brand's buttons to use on a band. Sites style buttons for the background
 * they sit on (a white button on the green hero, a green one on white), so the page
 * picks per band instead of asking anyone to: buttons measured on that background
 * first, then any that stay visible on it.
 */
export function buttonsFor(brand: Brand, tone: Tone | "hero"): { primary: string; secondary: string; visible: boolean } {
  const sem = semanticColors(brand);
  const bg = tone === "brand" || tone === "hero" ? sem.brand : tone === "subtle" ? sem.subtle : sem.surface;
  const edge = (b: ButtonStyle) => (b.kind === "filled" ? b.background : b.borderColor) ?? b.color;
  const visible = (b: ButtonStyle) =>
    // Labels are normal-size text, so they need WCAG AA's 4.5:1 to pass the publish checks.
    b.kind === "text" ? contrastRatio(b.color, bg) >= 4.5 : contrastRatio(edge(b), bg) >= 1.4 && contrastRatio(b.color, b.background ?? bg) >= 4.5;
  const here = (b: ButtonStyle) => (tone === "subtle" ? b.context === sem.surface || b.context === bg : b.context === bg);

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

/** Match where the site puts its header: a logo drawn in the brand colour vanishes on a brand band. */
export const navTone = (brand: Brand): "brand" | "surface" =>
  brand.colors.find((c) => c.role === "brand")?.usage.includes("navigation") ? "brand" : "surface";
