/**
 * Writes the token file the components use. Nothing in it is typed by hand: every value
 * comes from walking Helm's own token graph, and the three tiers (primitive, semantic,
 * component) and both modes are kept as Helm has them. Names are rewritten into this
 * package's `--sl-` namespace so the file is clearly a study, not Helm's code.
 */
import { references, resolve, tierOf, type Mode, type TokenGraph } from "./tokens.ts";

/** The component tokens Button and Link read, by the Helm token each one mirrors. */
export const COMPONENT_TOKENS: Record<string, string> = {
  "--sl-button-primary-bg": "--hds-color-button-primary-bg",
  "--sl-button-primary-bg-hover": "--hds-color-button-primary-bgHover",
  "--sl-button-primary-bg-disabled": "--hds-color-button-primary-bgDisabled",
  "--sl-button-primary-text": "--hds-color-button-primary-text",
  "--sl-button-primary-text-disabled": "--hds-color-button-primary-textDisabled",
  "--sl-button-secondary-bg": "--hds-color-button-secondary-bg",
  "--sl-button-secondary-bg-hover": "--hds-color-button-secondary-bgHover",
  "--sl-button-secondary-text": "--hds-color-button-secondary-text",
  "--sl-button-secondary-text-hover": "--hds-color-button-secondary-textHover",
  "--sl-button-secondary-text-disabled": "--hds-color-button-secondary-textDisabled",
  "--sl-button-secondary-border": "--hds-color-button-secondary-borderOnSubdued",
  "--sl-button-secondary-border-hover": "--hds-color-button-secondary-borderHover",
  "--sl-button-secondary-border-disabled": "--hds-color-button-secondary-borderDisabled",
  "--sl-link-text": "--hds-color-action-text-solid",
  "--sl-link-text-hover": "--hds-color-action-text-solidHover",
  "--sl-focus-ring": "--hds-color-action-focus-outer",
  "--sl-button-radius": "--hds-space-core-radius-sm",
  "--sl-button-gap": "--hds-space-core-100",
  "--sl-button-pad-inline": "--hds-space-core-300",
  "--sl-link-gap": "--hds-space-core-100",
  "--sl-page-bg": "--hds-color-surface-bg-quiet",
  "--sl-page-text": "--hds-color-text-solid",
  "--sl-page-text-soft": "--hds-color-text-soft",
};

/** --hds-color-core-brand-600 → --sl-core-brand-600; --hds-space-core-300 → --sl-space-300. */
export function rename(helm: string): string {
  return "--sl-" + helm.replace(/^--hds-/, "").replace(/^color-/, "").replace(/^space-core-/, "space-");
}

const renameRefs = (value: string, names: (n: string) => string) =>
  value
    .replace(/var\(\s*(--hds-[A-Za-z0-9_-]+)\s*/g, (_, n: string) => `var(${names(n)}`)
    .replace(/\s+/g, " ")
    .replace(/\s*\)/g, ")");

export interface BuiltToken {
  name: string;
  helm: string;
  tier: "primitive" | "semantic" | "component";
  light: string;
  dark?: string;
  /** The value it resolves to, per mode, for tests and docs. */
  resolved: Record<Mode, string | undefined>;
}

function defValue(graph: TokenGraph, name: string, mode: Mode): string | undefined {
  const own = graph.defs.filter((d) => d.name === name && d.scope === mode);
  const light = graph.defs.filter((d) => d.name === name && d.scope === "light");
  return (own[own.length - 1] ?? light[light.length - 1])?.value;
}

/**
 * Builds the three tiers. A Helm component token (button colours) is mirrored under
 * this package's name. A component token here that Helm keeps in its semantic or
 * primitive layer (link colour, radius) becomes a new component token that points at
 * the mirrored Helm token, so components only ever read their own tier.
 */
export function buildTokens(graph: TokenGraph): BuiltToken[] {
  const own = new Map<string, string>();
  for (const [mine, helm] of Object.entries(COMPONENT_TOKENS)) if (tierOf(helm, "--hds-") === "component") own.set(helm, mine);
  const names = (n: string) => own.get(n) ?? rename(n);

  const out = new Map<string, BuiltToken>();
  const resolved = (helm: string) => ({ light: resolve(graph, helm, "light").value, dark: resolve(graph, helm, "dark").value });
  const visit = (helm: string) => {
    if (out.has(helm)) return;
    const light = defValue(graph, helm, "light");
    if (light === undefined) throw new Error(`${helm} isn't defined in Helm's CSS any more`);
    const dark = defValue(graph, helm, "dark");
    out.set(helm, {
      name: names(helm),
      helm,
      tier: own.has(helm) ? "component" : /-(core|util)-/.test(helm) ? "primitive" : "semantic",
      light: renameRefs(light, names),
      dark: dark !== undefined && dark !== light ? renameRefs(dark, names) : undefined,
      resolved: resolved(helm),
    });
    const refs = new Set([...references(light), ...(dark ? references(dark) : [])].filter((r) => r.startsWith("--hds-")));
    for (const r of refs) visit(r);
  };
  const extra: BuiltToken[] = [];
  for (const mine of Object.keys(COMPONENT_TOKENS)) {
    const clash = [...out.keys()].find((h) => rename(h) === mine && !own.has(h));
    if (clash) throw new Error(`${mine} would shadow the mirror of ${clash}; give the component token its own name`);
  }
  for (const [mine, helm] of Object.entries(COMPONENT_TOKENS)) {
    visit(helm);
    if (!own.has(helm)) extra.push({ name: mine, helm, tier: "component", light: `var(${rename(helm)})`, resolved: resolved(helm) });
  }
  return [...out.values(), ...extra];
}

const ORDER = { primitive: 0, semantic: 1, component: 2 } as const;

export function tokensCss(tokens: BuiltToken[], source: string): string {
  const sorted = [...tokens].sort((a, b) => ORDER[a.tier] - ORDER[b.tier] || a.name.localeCompare(b.name));
  // A custom property's var() is substituted on the element that declares it, and the
  // result is what inherits. So an alias declared on :root keeps its light value inside
  // .sl-mode-dark unless it's declared again there: every alias is repeated in the dark
  // scope, not only the ones whose own value changes.
  const inDark = (t: BuiltToken) => t.dark !== undefined || t.light.includes("var(");
  const block = (tier: BuiltToken["tier"], mode: Mode) =>
    sorted
      .filter((t) => t.tier === tier && (mode === "light" || inDark(t)))
      .map((t) => `  ${t.name}: ${mode === "light" ? t.light : (t.dark ?? t.light)}; /* ${t.helm} */`)
      .join("\n");
  const section = (mode: Mode) =>
    (["primitive", "semantic", "component"] as const)
      .map((tier) => {
        const body = block(tier, mode);
        return body ? `  /* ${tier} */\n${body}` : "";
      })
      .filter(Boolean)
      .join("\n\n");
  return `/*
 * Generated by \`pnpm --filter @lph/helm-study build\` from ${source}.
 * Do not edit: every value is read from Helm's token graph. The comment on each line
 * names the Helm token it mirrors.
 */

:root,
.sl-mode-light {
${section("light")}
}

.sl-mode-dark {
${section("dark")}
}
`;
}
