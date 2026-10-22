import { checkContrast, semanticColors, type Brand, type ColorToken } from "@lph/tokens";

const pct = (n: number) => `${Math.round(n * 100)}%`;
const confidenceLabel = (n: number) => (n >= 0.75 ? "high" : n >= 0.5 ? "medium" : "low");
const roleOrder: ColorToken["role"][] = ["brand", "accent", "ink", "surface", "neutral"];
const path = (url: string) => {
  try {
    const u = new URL(url);
    return u.pathname === "/" ? u.host : u.host + u.pathname;
  } catch {
    return url;
  }
};

/**
 * Design.md: the brand written for agents. Every value in it comes from the
 * measured brand, so regenerating it after an edit in the Theme tab keeps
 * the two in sync. It is never edited by hand.
 */
export function generateDesignMd(brand: Brand): string {
  const sem = semanticColors(brand);
  const lines: string[] = [];
  const out = (...l: string[]) => lines.push(...l);

  out(
    `# ${brand.name} design system`,
    "",
    `Source of truth for ${brand.name}'s brand and UI. Use it when generating landing pages, product surfaces or campaign assets so everything stays on-brand. Values were measured from the live site (${brand.pages.map(path).join(", ")}) and reviewed by a person; do not invent new colours, fonts, radii or spacing.`,
    "",
    "## Brand summary",
    "",
    brand.summary,
    "",
    "## How to use these tokens",
    "",
    "- Import `tokens.css` once. It defines every value below as a CSS custom property.",
    "- Build with the `@lph/ui` starter components (`lph-button`, `lph-card`, `lph-hero`, `lph-section`, `lph-nav`, `lph-footer`, `lph-form`). They read the semantic variables, so they are on-brand automatically.",
    "- Prefer semantic variables (`--color-brand`, `--color-accent`, `--font-heading`, `--radius-card`) over raw palette variables.",
    "- If something you need isn't here, use the closest token and flag it for review rather than adding a value.",
    "",
    "## Colours",
    "",
  );
  for (const role of roleOrder) {
    for (const c of brand.colors.filter((c) => c.role === role)) {
      out(`- **${c.name}** \`${c.value}\` (\`--color-${c.name}\`, ${c.role}): ${c.usage.join(", ") || "supporting colour"}.`);
    }
  }
  out(
    "",
    "Semantic aliases:",
    "",
    "| Variable | Value | Use |",
    "|---|---|---|",
    `| \`--color-surface\` | \`${sem.surface}\` | Page background |`,
    `| \`--color-ink\` | \`${sem.ink}\` | Body text and headings on the page background |`,
    `| \`--color-brand\` | \`${sem.brand}\` | Brand bands (hero, navigation, footer) |`,
    `| \`--color-on-brand\` | \`${sem.onBrand}\` | Text on brand bands |`,
    `| \`--color-accent\` | \`${sem.accent}\` | Calls to action, highlights |`,
    `| \`--color-muted\` | \`${sem.muted}\` | Secondary text |`,
    `| \`--color-border\` | \`${sem.border}\` | Dividers and card borders |`,
    "",
    "## Typography",
    "",
    `- Headings: **${brand.fonts.heading}** (\`--font-heading\`)`,
    `- Body: **${brand.fonts.body}** (\`--font-body\`)`,
    "",
    "| Role | Font | Size | Mobile | Weight | Line height | Tracking | Case |",
    "|---|---|---|---|---|---|---|---|",
    ...brand.typography.map(
      (t) =>
        `| ${t.role} | ${t.fontFamily} | ${t.fontSize}px | ${t.mobileFontSize ? `${t.mobileFontSize}px` : "same"} | ${t.fontWeight} | ${t.lineHeight}px | ${t.letterSpacing}px | ${t.textTransform === "none" ? "as written" : t.textTransform} |`,
    ),
    "",
    "Variables follow the pattern `--text-<role>-size`, `-weight`, `-line-height`, `-tracking`, `-transform`, `-family`.",
    "",
    "## Buttons",
    "",
  );
  for (const b of brand.buttons) {
    if (b.kind === "text") {
      out(`- **${b.name}**: text link, \`${b.color}\`, weight ${b.fontWeight}. Class \`lph-button lph-button--${b.name}\`.`);
      continue;
    }
    out(
      `- **${b.name}** (${b.kind}): ${b.background ? `background \`${b.background}\`, ` : ""}text \`${b.color}\`${b.borderColor ? `, ${b.borderWidth}px \`${b.borderColor}\` border` : ""}, ${b.radius >= 9999 ? "pill" : `${b.radius}px radius`}, padding ${b.paddingY}px ${b.paddingX}px, ${b.fontSize}px/${b.fontWeight}${b.textTransform !== "none" ? `, ${b.textTransform}` : ""}. Seen as "${b.sampleText}" on \`${b.context}\`. Class \`lph-button lph-button--${b.name}\`.`,
    );
  }
  out("", "## Cards", "");
  for (const c of brand.cards) {
    out(
      `- **${c.name}**: background \`${c.background}\`${c.borderColor ? `, ${c.borderWidth}px \`${c.borderColor}\` border` : ", no border"}, ${c.radius}px radius, ${c.padding}px padding${c.shadow ? `, shadow \`${c.shadow}\`` : ""}. Class \`lph-card lph-card--${c.name}\`.`,
    );
  }
  if (brand.input) {
    const i = brand.input;
    out(
      "",
      "## Form fields",
      "",
      `Background \`${i.background}\`, text \`${i.color}\`${i.borderColor ? `, ${i.borderWidth}px \`${i.borderColor}\` border` : ""}, ${i.radius}px radius, padding ${i.paddingY}px ${i.paddingX}px, ${i.fontSize}px.`,
    );
  }
  out(
    "",
    "## Radius",
    "",
    brand.radii.map((r) => `\`--radius-${r.name}\` ${r.value >= 9999 ? "pill" : `${r.value}px`}`).join(" · ") || "No radius tokens.",
    "",
    "## Spacing",
    "",
    brand.spacing.map((s) => `\`--space-${s.name}\` ${s.value}px`).join(" · ") || "No spacing tokens.",
    "",
    "## Logo",
    "",
    brand.logo
      ? `Found in the site header (${brand.logo.kind}${brand.logo.text ? `, "${brand.logo.text}"` : ""}). Use the file in this folder; never recreate it with text.`
      : "No logo was found. Ask for one before designing.",
    "",
    "## Usage rules",
    "",
    ...brand.usageRules.map((r) => `- ${r}`),
    "",
    "## Accessibility",
    "",
    "| Pair | Ratio | WCAG |",
    "|---|---|---|",
    ...checkContrast(brand).map(
      (c) => `| ${c.subject} (\`${c.foreground}\` on \`${c.background}\`) | ${c.ratio}:1 | ${c.level === "fail" ? "**fails**" : c.level} |`,
    ),
    "",
    "Pairs marked AA-large are only for text 18px and up (or 14px bold). Never use a failing pair for text.",
    "",
    "## Provenance",
    "",
    `Measured from ${brand.pages.map((p) => `<${p}>`).join(" and ")}. Confidence by group:`,
    "",
    `- Colours: ${brand.colors.map((c) => `${c.name} ${confidenceLabel(c.confidence)}`).join(", ")}`,
    `- Type: ${brand.typography.map((t) => `${t.role} ${confidenceLabel(t.confidence)}`).join(", ")}`,
    `- Buttons: ${brand.buttons.map((b) => `${b.name} ${confidenceLabel(b.confidence)}`).join(", ")}`,
  );
  const open = brand.conflicts.filter((c) => c.options.length > 1);
  if (open.length) {
    out("", "Resolved conflicts:", "");
    for (const c of open) {
      out(`- \`${c.field}\`: using **${c.resolved ?? c.options[0]!.value}** (${c.options.map((o) => `${o.value} ${pct(o.share)}`).join(", ")}).`);
    }
  }
  return lines.join("\n") + "\n";
}
