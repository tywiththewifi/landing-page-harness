/**
 * Measures live components in a browser: computed styles at rest and on hover, plus the
 * hover arrow's travel. The same function measures the live site and this package's own
 * components, so the parity test compares like with like.
 */
import type { Page } from "playwright";

export const STYLE_PROPS = [
  "backgroundColor",
  "color",
  "borderTopWidth",
  "borderTopColor",
  "borderTopLeftRadius",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "columnGap",
  "height",
  "transitionDuration",
  "transitionTimingFunction",
] as const;
export type StyleProp = (typeof STYLE_PROPS)[number];

export interface Measurement {
  label: string;
  page: string;
  selector: string;
  text: string;
  rest: Record<StyleProp, string>;
  hover: Partial<Record<StyleProp, string>>;
  /** px the hover arrow moves right on hover, when there is one. */
  arrowTravel?: number;
}

export interface Target {
  label: string;
  selector: string;
}

/** The Helm buttons and links on stripe.com's home page, and the older button they replace. */
export const HELM_TARGETS: Target[] = [
  { label: "Button / primary", selector: "main .hds-button.hds-button--primary:not(.hds-button--compact)" },
  { label: "Button / primary / compact", selector: ".hds-button.hds-button--primary.hds-button--compact" },
  { label: "Button / secondary", selector: "main .hds-button.hds-button--secondary:not(.hds-button--compact):not([class*='hero-section'])" },
  { label: "Link / callout", selector: "main .hds-link.hds-link--callout" },
];
export const LEGACY_TARGETS: Target[] = [{ label: "CtaButton / Button", selector: ".CtaButton.variant--Button:not(.SiteHeader *)" }];

const read = (page: Page, handle: string) =>
  page.evaluate(
    ([sel, props]) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return null;
      const s = getComputedStyle(el);
      const out: Record<string, string> = {};
      for (const p of props) out[p] = (s as unknown as Record<string, string>)[p] ?? "";
      const arrow = el.querySelector(".arrow-group, .sl-hover-arrow__group");
      const m = arrow ? new DOMMatrix(getComputedStyle(arrow).transform === "none" ? undefined : getComputedStyle(arrow).transform) : null;
      return { styles: out, text: (el.textContent || "").trim().slice(0, 60), arrowX: m ? m.m41 : null };
    },
    [handle, STYLE_PROPS as unknown as string[]] as const,
  );

export async function measure(page: Page, pageLabel: string, targets: Target[]): Promise<Measurement[]> {
  const out: Measurement[] = [];
  for (const t of targets) {
    const loc = page.locator(t.selector).filter({ visible: true }).first();
    if (!(await loc.count())) continue;
    // Tag the exact element so the reads before and after hover hit the same one.
    await loc.evaluate((el) => el.setAttribute("data-measure", "1"));
    const sel = "[data-measure='1']";
    await loc.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(400);
    const rest = await read(page, sel);
    await loc.hover();
    await page.waitForTimeout(600);
    const hovered = await read(page, sel);
    await page.mouse.move(0, 0);
    await loc.evaluate((el) => el.removeAttribute("data-measure"));
    if (!rest || !hovered) continue;
    const hover: Measurement["hover"] = {};
    for (const p of STYLE_PROPS) if (hovered.styles[p] !== rest.styles[p]) hover[p] = hovered.styles[p];
    out.push({
      label: t.label,
      page: pageLabel,
      selector: t.selector,
      text: rest.text,
      rest: rest.styles as Record<StyleProp, string>,
      hover,
      arrowTravel: rest.arrowX !== null && hovered.arrowX !== null ? Math.round((hovered.arrowX - rest.arrowX) * 100) / 100 : undefined,
    });
  }
  return out;
}
