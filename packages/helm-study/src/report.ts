import type { PageAdoption } from "./adoption.ts";
import type { BuiltToken } from "./build-tokens.ts";
import type { Measurement } from "./measure.ts";
import type { TokenReport } from "./tokens.ts";

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function adoptionMarkdown(pages: PageAdoption[], takenAt: string): string {
  const helm = pages.filter((p) => p.system === "helm");
  const legacy = pages.filter((p) => p.system === "legacy");
  const mixed = pages.filter((p) => p.system === "mixed");
  const roles = Object.keys(pages[0]?.roles ?? {});
  const leftToMove = Object.fromEntries(roles.map((r) => [r, legacy.concat(mixed).reduce((n, p) => n + (p.roles[r]?.legacy ?? 0), 0)]));
  return `# Helm adoption on stripe.com

Read on ${takenAt.slice(0, 10)} from ${pages.length} main marketing pages, as a browser renders them.

**${helm.length} of ${pages.length} pages run on Helm** (${helm.map((p) => `\`${p.path}\``).join(", ")}). ${legacy.length} still run on the older system${mixed.length ? `, and ${mixed.length} mix the two` : ", and none mix the two: pages move across whole"}.

| Page | System | Helm share | Helm elements | Older elements |
|---|---|---|---|---|
${pages.map((p) => `| \`${p.path}\` | ${p.system} | ${pct(p.helmShare)} | ${p.helmElements} | ${p.legacyElements} |`).join("\n")}

## What's left to move

Elements using each older component across the pages not yet on Helm, next to the Helm component that replaces it.

| Role | Older component | Helm component | Elements left |
|---|---|---|---|
| Button | \`CtaButton\` | \`hds-button\` | ${leftToMove["Button"]} |
| Hover arrow | \`HoverArrow\` | \`hds-icon-hover-arrow\` | ${leftToMove["Hover arrow"]} |
| Navigation | \`SiteHeader\`, \`RefreshedNavigation\` | \`hds-navigation-menu\` | ${leftToMove["Navigation"]} |
| Text | \`Copy\` | \`hds-text\`, \`hds-heading\` | ${leftToMove["Text"]} |
| Link | \`Link\` | \`hds-link\` | ${leftToMove["Link"]} |

## Helm components in use

${[...new Set(helm.flatMap((p) => p.helmComponents))].sort().map((c) => `\`${c}\``).join(", ")}

*How it's counted:* an element counts as Helm if it has an \`hds-\` class, and as older if it has a PascalCase block class such as \`CtaButton\` or \`Copy__body\`. A page is "helm" above 80% Helm share and "legacy" below 5%.
`;
}

export function tokensMarkdown(r: TokenReport, takenAt: string, files: number): string {
  const failing = r.pairs.filter((p) => p.passes === false);
  return `# Helm's token graph

Rebuilt on ${takenAt.slice(0, 10)} from the ${files} stylesheets stripe.com's home page loads. Only custom-property declarations and \`var()\` references were read.

## Shape

| | Tokens |
|---|---|
| Primitive (\`color-core-*\`, \`color-util-*\`, \`space-core-*\`, font weights and families) | ${r.byTier.primitive} |
| Semantic (\`color-action-*\`, \`color-surface-*\`, \`color-text-*\`, layout and section spacing, type roles) | ${r.byTier.semantic} |
| Component (\`color-button-*\`, \`color-input-*\`, \`toggle-tabs-*\`, ...) | ${r.byTier.component} |
| **Total** | **${r.total}** |

${r.modeAware} tokens resolve to a different value in dark mode (\`.hds-mode--dark\`) than in light. Buttons reach their colours through all three tiers: \`--hds-color-button-primary-bg\` → \`--hds-color-action-bg-solid\` → \`--hds-color-core-brand-600\` (\`#533afd\`), and dark mode swaps only the middle link, to \`brandDark-600\`.

## Health checks

**References to tokens defined nowhere (${r.dangling.length}).** Read with no fallback, so the property drops silently unless a script sets the token at runtime. Worth a look, not proof of a bug:

${r.dangling.map((d) => `- \`${d.token}\``).join("\n") || "- none"}

The two worth checking first: \`--hds-color-text-subtle\` (the defined text tokens are \`solid\`, \`soft\`, \`subdued\` and \`quiet\`, so this reads like a renamed token; it colours the calling code in the phone input) and \`--hds-font-weight-medium\` (only \`bold\` and \`normal\` exist).

**Inputs with a fallback (${r.knobs.length}).** Read with a default and never defined, so they're settings a consumer can pass in: ${r.knobs.map((k) => `\`${k}\``).join(", ")}.

**Defined but never read in these stylesheets (${r.unused.length}).** Expected for a system: many belong to components the home page doesn't load, or are read by script. A full-site pass would narrow this list.

**Component tokens that skip the semantic layer (${r.skipsSemantic.length}).** These point a component colour straight at a primitive. ${r.skipsSemantic.filter((s) => s.ownDark).length} of the ${r.skipsSemantic.length} have their own dark-mode value${r.skipsSemantic.every((s) => s.ownDark) ? ", so this looks deliberate: these components are themed directly, mode by mode, rather than through the semantic layer. The cost is that a change to the semantic layer, such as a brand refresh, has to be repeated here" : ""}. ${r.skipsSemantic.filter((s) => s.token.includes("-input-")).length} are input colours:

${r.skipsSemantic.slice(0, 12).map((s) => `- \`${s.token}\` → \`${s.target}\``).join("\n")}${r.skipsSemantic.length > 12 ? `\n- ...and ${r.skipsSemantic.length - 12} more` : ""}

**Semantic tokens that point at a component token (${r.inverted.length}).** ${r.inverted.length ? r.inverted.map((i) => `\`${i.token}\` → \`${i.target}\``).join(", ") : "None: the layers only point downwards."}

## Contrast of button and link colours

Resolved through the graph in each mode. Labels are 16px, so the bar is 4.5:1. A transparent background is checked against the mode's quiet surface.

| Pair | Mode | Text | Background | Ratio | |
|---|---|---|---|---|---|
${r.pairs.map((p) => `| ${p.label} | ${p.mode} | \`${p.textValue ?? "?"}\` | \`${p.backgroundValue ?? "?"}\` | ${p.ratio ?? "?"} | ${p.passes === undefined ? "?" : p.passes ? "pass" : "**fail**"} |`).join("\n")}

${failing.length ? `${failing.length} pair(s) fall short of 4.5:1.` : "Every pair passes."}
`;
}

export function migrationMarkdown(live: Measurement[]): string {
  const legacy = live.find((m) => m.label.startsWith("CtaButton"));
  const helm = live.find((m) => m.label === "Button / primary");
  if (!legacy || !helm) return "";
  const rows: [string, string, string][] = [
    ["Background", legacy.rest.backgroundColor, helm.rest.backgroundColor],
    ["Background on hover", legacy.hover.backgroundColor ?? legacy.rest.backgroundColor, helm.hover.backgroundColor ?? helm.rest.backgroundColor],
    ["Corner radius", legacy.rest.borderTopLeftRadius, helm.rest.borderTopLeftRadius],
    ["Height", legacy.rest.height, helm.rest.height],
    ["Padding (top right bottom left)", [legacy.rest.paddingTop, legacy.rest.paddingRight, legacy.rest.paddingBottom, legacy.rest.paddingLeft].join(" "), [helm.rest.paddingTop, helm.rest.paddingRight, helm.rest.paddingBottom, helm.rest.paddingLeft].join(" ")],
    ["Type", `${legacy.rest.fontSize} / ${legacy.rest.lineHeight}, weight ${legacy.rest.fontWeight}, tracking ${legacy.rest.letterSpacing}`, `${helm.rest.fontSize} / ${helm.rest.lineHeight}, weight ${helm.rest.fontWeight}, tracking ${helm.rest.letterSpacing}`],
    ["Motion", `${legacy.rest.transitionDuration.split(",")[0]} ${legacy.rest.transitionTimingFunction.split("),")[0]}${legacy.rest.transitionTimingFunction.includes("),") ? ")" : ""}`, `${helm.rest.transitionDuration.split(",")[0]} ${helm.rest.transitionTimingFunction.split("),")[0]})`],
    ["Hover arrow", legacy.arrowTravel ? `${legacy.arrowTravel}px` : "animates its own path", helm.arrowTravel ? `slides ${helm.arrowTravel}px, shaft fades in` : "none"],
  ];
  return `# Moving a page's main button to Helm

The main call to action on \`${legacy.page}\` ("${legacy.text}", older \`CtaButton\`) next to the one on \`${helm.page}\` ("${helm.text}", Helm \`hds-button--primary\`), both as rendered.

| | Older \`CtaButton\` | Helm \`hds-button--primary\` |
|---|---|---|
${rows.map(([k, a, b]) => `| ${k} | ${a} | ${b} |`).join("\n")}

Moving a page across isn't a rename: the button's height changes by ${parseFloat(helm.rest.height) - parseFloat(legacy.rest.height)}px, its corners go from ${legacy.rest.borderTopLeftRadius} to ${helm.rest.borderTopLeftRadius}, and both its colour and its hover colour change. Anything laid out around the old ${legacy.rest.height} button (hero spacing, button rows) needs checking on each page that moves.

This is also where Softlander's own extractor went wrong on stripe.com: it measured the home page (Helm) and \`/payments\` (older) together and picked the older pill as the primary button, because it appeared on more elements. It needs to notice when one site runs two systems.
`;
}

export function tokensTable(tokens: BuiltToken[]): string {
  return tokens
    .filter((t) => t.tier === "component")
    .map((t) => `| \`${t.name}\` | \`${t.helm}\` | \`${t.resolved.light}\` | \`${t.resolved.dark}\` |`)
    .join("\n");
}
