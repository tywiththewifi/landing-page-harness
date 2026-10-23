import { contrastRatio, luminance } from "./color.ts";
import type { Brand, ButtonStyle, CardStyle, ColorToken, TypeToken } from "./types.ts";

const px = (n: number) => `${round(n)}px`;
const round = (n: number) => Math.round(n * 100) / 100;
const fontStack = (family: string) =>
  /[\s]/.test(family) && !/^["']/.test(family) ? `"${family}"` : family;

export function firstColor(brand: Brand, role: ColorToken["role"]): ColorToken | undefined {
  return brand.colors.find((c) => c.role === role);
}

/** The neutrals sorted from lightest to darkest. */
function neutrals(brand: Brand): ColorToken[] {
  return brand.colors
    .filter((c) => c.role === "neutral")
    .sort((a, b) => luminance(b.value) - luminance(a.value));
}

/** Semantic aliases the starter components rely on, so they work for any brand. */
export function semanticColors(brand: Brand) {
  const surface = firstColor(brand, "surface")?.value ?? "#ffffff";
  const ink = firstColor(brand, "ink")?.value ?? "#111111";
  const brandColor = firstColor(brand, "brand")?.value ?? ink;
  const accent = firstColor(brand, "accent")?.value ?? brandColor;
  const n = neutrals(brand);
  // Neutrals ordered from closest to the surface to furthest, so this works on dark sites too.
  const byContrast = [...n].sort((a, b) => contrastRatio(a.value, surface) - contrastRatio(b.value, surface));
  const border =
    brand.cards.find((c) => c.borderColor)?.borderColor ??
    byContrast.find((c) => contrastRatio(c.value, surface) > 1.05)?.value ??
    "#e5e7eb";
  // Muted text: readable, but softer than ink. Colours seen on text win over ones that aren't.
  const inkContrast = contrastRatio(ink, surface);
  const mutedCandidates = byContrast.filter((c) => {
    const ratio = contrastRatio(c.value, surface);
    return ratio >= 4.5 && ratio < inkContrast;
  });
  const muted = (mutedCandidates.find((c) => c.usage.includes("text")) ?? mutedCandidates[0])?.value ?? ink;
  const subtle = byContrast.find((c) => contrastRatio(c.value, surface) > 1.05)?.value ?? surface;
  // What the site actually puts on its brand colour wins when body text can be read in it
  // (a button label can get away with less); otherwise the more readable of white and ink.
  const measuredOnBrand = brand.buttons.find((b) => b.kind === "filled" && b.background === brandColor && contrastRatio(b.color, brandColor) >= 4.5)?.color;
  const onBrand =
    measuredOnBrand ?? (contrastRatio("#ffffff", brandColor) >= contrastRatio(ink, brandColor) ? "#ffffff" : ink);
  return { surface, ink, brand: brandColor, accent, border, muted, subtle, onBrand };
}

function familyVar(t: TypeToken, fonts: Brand["fonts"]): string {
  if (t.fontFamily === fonts.heading) return "--font-heading";
  if (t.fontFamily === fonts.body) return "--font-body";
  return `--font-${t.role}`;
}

function typeVars(t: TypeToken, fonts: Brand["fonts"]): string[] {
  const p = `--text-${t.role}`;
  return [
    `${p}-family: var(${familyVar(t, fonts)});`,
    `${p}-size: ${px(t.fontSize)};`,
    `${p}-weight: ${t.fontWeight};`,
    `${p}-line-height: ${px(t.lineHeight)};`,
    `${p}-tracking: ${px(t.letterSpacing)};`,
    `${p}-transform: ${t.textTransform};`,
  ];
}

function buttonVars(b: ButtonStyle): string[] {
  const p = `--button-${b.name}`;
  return [
    `${p}-bg: ${b.background ?? "transparent"};`,
    `${p}-fg: ${b.color};`,
    `${p}-border: ${b.borderColor ?? "transparent"};`,
    `${p}-border-width: ${px(b.borderWidth)};`,
    `${p}-radius: ${b.radius >= 9999 ? "9999px" : px(b.radius)};`,
    `${p}-px: ${px(b.paddingX)};`,
    `${p}-py: ${px(b.paddingY)};`,
    `${p}-size: ${px(b.fontSize)};`,
    `${p}-weight: ${b.fontWeight};`,
    `${p}-transform: ${b.textTransform};`,
  ];
}

function cardVars(c: CardStyle): string[] {
  const p = `--card-${c.name}`;
  return [
    `${p}-bg: ${c.background};`,
    `${p}-border: ${c.borderColor ?? "transparent"};`,
    `${p}-border-width: ${px(c.borderWidth)};`,
    `${p}-radius: ${px(c.radius)};`,
    `${p}-shadow: ${c.shadow ?? "none"};`,
    `${p}-padding: ${px(c.padding)};`,
  ];
}

const indent = (lines: string[], n = 2) => lines.map((l) => " ".repeat(n) + l).join("\n");

/**
 * Builds tokens.css: raw tokens, semantic aliases, and modifier classes for the
 * brand's own button and card variants (their names differ per brand, so they
 * are generated here rather than hard-coded in the component stylesheet).
 */
export function toCss(brand: Brand, opts: { selector?: string } = {}): string {
  const sel = opts.selector ?? ":root";
  const sem = semanticColors(brand);
  const primaryButton = brand.buttons[0];
  const firstCard = brand.cards[0];

  const otherFamilies = brand.typography
    .filter((t) => t.fontFamily !== brand.fonts.heading && t.fontFamily !== brand.fonts.body)
    .map((t) => `--font-${t.role}: ${fontStack(t.fontFamily)}, sans-serif;`);

  const root: string[] = [
    "/* Colours */",
    ...brand.colors.map((c) => `--color-${c.name}: ${c.value};`),
    "",
    "/* Semantic colours (used by @lph/ui) */",
    `--color-surface: ${sem.surface};`,
    `--color-ink: ${sem.ink};`,
    `--color-brand: ${sem.brand};`,
    `--color-on-brand: ${sem.onBrand};`,
    `--color-accent: ${sem.accent};`,
    `--color-border: ${sem.border};`,
    `--color-muted: ${sem.muted};`,
    `--color-subtle: ${sem.subtle};`,
    "",
    "/* Fonts */",
    `--font-heading: ${fontStack(brand.fonts.heading)}, sans-serif;`,
    `--font-body: ${fontStack(brand.fonts.body)}, sans-serif;`,
    ...otherFamilies,
    "",
    "/* Type scale */",
    ...brand.typography.flatMap((t) => typeVars(t, brand.fonts)),
    "",
    "/* Radius */",
    ...brand.radii.map((r) => `--radius-${r.name}: ${r.value >= 9999 ? "9999px" : px(r.value)};`),
    `--radius-button: ${primaryButton ? px(Math.min(primaryButton.radius, 9999)) : "8px"};`,
    `--radius-card: ${firstCard ? px(firstCard.radius) : "12px"};`,
    `--radius-input: ${brand.input ? px(brand.input.radius) : "8px"};`,
    "",
    "/* Spacing */",
    ...brand.spacing.map((s) => `--space-${s.name}: ${px(s.value)};`),
    "",
    "/* Buttons */",
    ...brand.buttons.flatMap(buttonVars),
    "",
    "/* Cards */",
    ...brand.cards.flatMap(cardVars),
  ];

  if (brand.input) {
    const i = brand.input;
    root.push(
      "",
      "/* Inputs */",
      `--input-bg: ${i.background};`,
      `--input-fg: ${i.color};`,
      `--input-border: ${i.borderColor ?? "transparent"};`,
      `--input-border-width: ${px(i.borderWidth)};`,
      `--input-px: ${px(i.paddingX)};`,
      `--input-py: ${px(i.paddingY)};`,
      `--input-size: ${px(i.fontSize)};`,
    );
  }

  const mobile = brand.typography.filter(
    (t) => t.mobileFontSize && Math.abs(t.mobileFontSize - t.fontSize) >= 1,
  );

  const blocks = [
    `/* ${brand.name} design tokens. Generated by landing-page-harness from ${brand.pages.join(", ")}. */`,
    `${sel} {\n${indent(root)}\n}`,
  ];
  if (mobile.length) {
    blocks.push(
      `@media (max-width: 600px) {\n  ${sel} {\n${indent(
        mobile.map((t) => `--text-${t.role}-size: ${px(t.mobileFontSize!)};`),
        4,
      )}\n  }\n}`,
    );
  }
  const scope = sel === ":root" ? "" : `${sel} `;
  blocks.push(
    ...brand.buttons.map((b) => {
      const p = `--button-${b.name}`;
      return `${scope}.lph-button--${b.name} {\n${indent(
        ["bg", "fg", "border", "border-width", "radius", "px", "py", "size", "weight", "transform"].map(
          (k) => `--_${k}: var(${p}-${k});`,
        ),
      )}\n}`;
    }),
    ...brand.cards.map((c) => {
      const p = `--card-${c.name}`;
      return `${scope}.lph-card--${c.name} {\n${indent(
        ["bg", "border", "border-width", "radius", "shadow", "padding"].map((k) => `--_${k}: var(${p}-${k});`),
      )}\n}`;
    }),
  );
  return blocks.join("\n\n") + "\n";
}

type Dtcg = Record<string, unknown>;

/** Design tokens in the W3C Design Tokens Community Group format. */
export function toDtcg(brand: Brand): Dtcg {
  const color: Dtcg = {};
  for (const c of brand.colors) {
    color[c.name] = {
      $type: "color",
      $value: c.value,
      $description: c.usage.join("; "),
      $extensions: { "dev.lph": { role: c.role, confidence: c.confidence } },
    };
  }
  const typography: Dtcg = {};
  for (const t of brand.typography) {
    typography[t.role] = {
      $type: "typography",
      $value: {
        fontFamily: [t.fontFamily, "sans-serif"],
        fontSize: px(t.fontSize),
        fontWeight: t.fontWeight,
        lineHeight: round(t.lineHeight / t.fontSize),
        letterSpacing: px(t.letterSpacing),
      },
      $extensions: { "dev.lph": { textTransform: t.textTransform, mobileFontSize: t.mobileFontSize } },
    };
  }
  const dims = (list: Brand["radii"]) =>
    Object.fromEntries(list.map((s) => [s.name, { $type: "dimension", $value: px(s.value) }]));

  return {
    $description: `${brand.name} design tokens, measured from ${brand.pages.join(", ")}`,
    color,
    font: {
      heading: { $type: "fontFamily", $value: [brand.fonts.heading, "sans-serif"] },
      body: { $type: "fontFamily", $value: [brand.fonts.body, "sans-serif"] },
    },
    typography,
    radius: dims(brand.radii),
    spacing: dims(brand.spacing),
    component: {
      button: Object.fromEntries(
        brand.buttons.map((b) => [
          b.name,
          {
            background: { $type: "color", $value: b.background ?? "transparent" },
            color: { $type: "color", $value: b.color },
            borderColor: { $type: "color", $value: b.borderColor ?? "transparent" },
            borderWidth: { $type: "dimension", $value: px(b.borderWidth) },
            radius: { $type: "dimension", $value: px(b.radius) },
            paddingX: { $type: "dimension", $value: px(b.paddingX) },
            paddingY: { $type: "dimension", $value: px(b.paddingY) },
          },
        ]),
      ),
      card: Object.fromEntries(
        brand.cards.map((c) => [
          c.name,
          {
            background: { $type: "color", $value: c.background },
            borderColor: { $type: "color", $value: c.borderColor ?? "transparent" },
            radius: { $type: "dimension", $value: px(c.radius) },
            shadow: { $type: "shadow", $value: c.shadow ?? "none" },
          },
        ]),
      ),
    },
  };
}

export interface ContrastCheck {
  subject: string;
  foreground: string;
  background: string;
  ratio: number;
  /** "AA" passes for body text, "AA-large" only for 18px+/14px bold, "fail" for neither. */
  level: "AAA" | "AA" | "AA-large" | "fail";
}

function level(ratio: number): ContrastCheck["level"] {
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3) return "AA-large";
  return "fail";
}

/** WCAG contrast for the pairs the starter components will actually render. */
export function checkContrast(brand: Brand): ContrastCheck[] {
  const sem = semanticColors(brand);
  const pairs: [string, string, string][] = [
    ["Body text on surface", sem.ink, sem.surface],
    ["Muted text on surface", sem.muted, sem.surface],
    ["Text on brand band", sem.onBrand, sem.brand],
    ...brand.buttons.map(
      (b) => [`Button "${b.name}"`, b.color, b.background ?? b.context] as [string, string, string],
    ),
  ];
  return pairs.map(([subject, foreground, background]) => {
    const ratio = round(contrastRatio(foreground, background));
    return { subject, foreground, background, ratio, level: level(ratio) };
  });
}
