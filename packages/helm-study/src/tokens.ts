/**
 * Reads a design system's public CSS and rebuilds its token graph: which custom
 * properties exist, which tier each belongs to, what each one points at, and what it
 * resolves to in light and dark mode. Then it checks the graph's health the way a
 * design-systems team would: references to tokens that don't exist, tokens nobody
 * uses, components that skip the semantic layer, and text/background pairs that fail
 * contrast.
 *
 * Only custom-property declarations and var() references are kept. No selectors,
 * rules or values beyond those leave this file.
 */
import postcss from "postcss";

export type Mode = "light" | "dark";
export type Tier = "primitive" | "semantic" | "component";

export interface TokenDef {
  name: string;
  value: string;
  /** "light" and "dark" are the system's colour modes; "scoped" means a definition inside one component's rule. */
  scope: Mode | "scoped";
  selector: string;
}

export interface TokenGraph {
  prefix: string;
  defs: TokenDef[];
  /** How many ordinary declarations (not custom properties) read each token. */
  uses: Map<string, number>;
  /** Tokens read at least once with no fallback, so an undefined one leaves the property unset. */
  bare: Set<string>;
}

const VAR = /var\(\s*(--[A-Za-z0-9_-]+)/g;

export function references(value: string): string[] {
  return [...value.matchAll(VAR)].map((m) => m[1]!);
}

function scopeOf(selector: string, darkClass: string, lightClass: string): TokenDef["scope"] {
  const parts = selector.split(",").map((s) => s.trim());
  if (parts.some((p) => p === darkClass || p.startsWith(darkClass + "."))) return "dark";
  if (parts.some((p) => p === ":root" || p === "html" || p === lightClass)) return "light";
  return "scoped";
}

export interface ParseOptions {
  /** e.g. "--hds-" */
  prefix: string;
  darkClass: string;
  lightClass: string;
}

function insideCondition(node: postcss.Node): boolean {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === "atrule" && /^(media|supports|container)$/.test((p as postcss.AtRule).name)) return true;
  }
  return false;
}

export function parseTokens(cssFiles: string[], opts: ParseOptions): TokenGraph {
  const defs: TokenDef[] = [];
  const uses = new Map<string, number>();
  const bare = new Set<string>();
  for (const css of cssFiles) {
    const root = postcss.parse(css);
    // @property --x { initial-value: ... } registers a token with a default, which counts as a definition.
    root.walkAtRules("property", (at) => {
      if (!at.params.startsWith(opts.prefix)) return;
      let initial = "";
      at.walkDecls("initial-value", (d) => { initial = d.value.trim(); });
      defs.push({ name: at.params.trim(), value: initial, scope: "scoped", selector: "@property" });
    });
    root.walkDecls((decl) => {
      if (decl.prop.startsWith(opts.prefix)) {
        const rule = decl.parent;
        const selector = rule && rule.type === "rule" ? (rule as postcss.Rule).selector : "";
        // Definitions inside @media, @supports or @container are responsive overrides; keep the base ones.
        // @layer only orders the cascade, so its definitions count.
        if (insideCondition(decl)) return;
        defs.push({ name: decl.prop, value: decl.value.trim(), scope: scopeOf(selector, opts.darkClass, opts.lightClass), selector });
        return;
      }
      for (const m of decl.value.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*(,)?/g)) {
        const ref = m[1]!;
        if (!ref.startsWith(opts.prefix)) continue;
        uses.set(ref, (uses.get(ref) ?? 0) + 1);
        if (!m[2]) bare.add(ref);
      }
    });
  }
  return { prefix: opts.prefix, defs, uses, bare };
}

/** Tier rules for Helm's naming. Anything not primitive or semantic belongs to one component. */
const PRIMITIVE = /^(color-(core|util)|space-core|font-weight|font-family)-/;
const SEMANTIC = /^(color-(action|surface|text|icon|accent|accentColorMode|shadow|heading)|space-(layout|section|block)|font-(heading|text)|shadow|focus|size|hover)-/;

export function tierOf(name: string, prefix: string): Tier {
  const bare = name.slice(prefix.length);
  if (PRIMITIVE.test(bare)) return "primitive";
  if (SEMANTIC.test(bare)) return "semantic";
  return "component";
}

/** The definition that applies in a mode: the mode's own, then light (the default). Scoped ones are ignored. */
function defIn(graph: TokenGraph, name: string, mode: Mode): TokenDef | undefined {
  const own = graph.defs.filter((d) => d.name === name && d.scope === mode);
  if (own.length) return own[own.length - 1];
  const light = graph.defs.filter((d) => d.name === name && d.scope === "light");
  return light[light.length - 1];
}

export interface Resolution {
  value?: string;
  chain: string[];
  /** The first name in the chain that has no definition. */
  missing?: string;
  cycle?: boolean;
}

export function resolve(graph: TokenGraph, name: string, mode: Mode): Resolution {
  const chain: string[] = [];
  let current = name;
  for (let i = 0; i < 20; i++) {
    if (chain.includes(current)) return { chain, cycle: true };
    chain.push(current);
    const def = defIn(graph, current, mode);
    if (!def) return { chain, missing: current };
    const refs = references(def.value);
    // A plain alias: var(--x) or var(--x, fallback). Anything more complex is a computed value.
    const alias = /^var\(\s*(--[A-Za-z0-9_-]+)\s*(,[^)]*)?\)$/.exec(def.value);
    if (alias) {
      current = alias[1]!;
      continue;
    }
    if (!refs.length) return { value: def.value, chain };
    return { value: def.value, chain };
  }
  return { chain, cycle: true };
}

// ---------- Colour ----------

export function parseColor(value: string): [number, number, number, number] | undefined {
  const v = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(v);
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  const rgb = /^rgba?\(([^)]+)\)$/.exec(v);
  if (rgb) {
    const parts = rgb[1]!.split(/[\s,/]+/).filter(Boolean).map((p) => (p.endsWith("%") ? parseFloat(p) / 100 : parseFloat(p)));
    const [r, g, b, a = 1] = parts;
    if ([r, g, b].some((x) => x === undefined || Number.isNaN(x))) return undefined;
    return [r!, g!, b!, a];
  }
  if (v === "transparent") return [0, 0, 0, 0];
  if (v === "white") return [255, 255, 255, 1];
  if (v === "black") return [0, 0, 0, 1];
  return undefined;
}

const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: number[]) => 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);

/** Composite a translucent colour over an opaque one. */
export function over(top: number[], bottom: number[]): number[] {
  const a = top[3] ?? 1;
  return [0, 1, 2].map((i) => top[i]! * a + bottom[i]! * (1 - a)).concat(1);
}

export function contrast(fg: number[], bg: number[]): number {
  const [l1, l2] = [luminance(over(fg, bg)), luminance(bg)].sort((a, b) => b - a);
  return (l1! + 0.05) / (l2! + 0.05);
}

// ---------- Health report ----------

export interface PairCheck {
  label: string;
  mode: Mode;
  text: string;
  background: string;
  textValue?: string;
  backgroundValue?: string;
  ratio?: number;
  /** 4.5 for body-size text, which button labels are. */
  passes?: boolean;
}

export interface TokenReport {
  total: number;
  byTier: Record<Tier, number>;
  /** Defined in light and given a different value in dark. */
  modeAware: number;
  /** Read with no fallback and defined nowhere in the CSS: the property silently drops, unless a script sets it. */
  dangling: { token: string; referencedBy: string }[];
  /** Read with a fallback and never defined: inputs a consumer can set, such as a column count. */
  knobs: string[];
  unused: string[];
  /** Component tokens that point straight at a primitive, skipping the semantic layer. */
  skipsSemantic: { token: string; target: string; ownDark: boolean }[];
  /** Semantic tokens that point at a component token: the dependency runs the wrong way. */
  inverted: { token: string; target: string }[];
  pairs: PairCheck[];
}

export function analyze(graph: TokenGraph, pairs: { label: string; text: string; background: string; surface?: string }[]): TokenReport {
  const { prefix } = graph;
  const global = graph.defs.filter((d) => d.scope !== "scoped");
  const names = [...new Set(graph.defs.map((d) => d.name))];
  const defined = new Set(names);
  const byTier: Record<Tier, number> = { primitive: 0, semantic: 0, component: 0 };
  for (const n of names) byTier[tierOf(n, prefix)]++;

  const referencedBy = new Map<string, string>();
  for (const d of graph.defs) for (const r of references(d.value)) if (r.startsWith(prefix) && !referencedBy.has(r)) referencedBy.set(r, d.name);
  const dangling = [...referencedBy].filter(([r]) => !defined.has(r)).map(([token, by]) => ({ token, referencedBy: by }));
  const knobs: string[] = [];
  for (const [r] of graph.uses) {
    if (defined.has(r) || dangling.some((d) => d.token === r)) continue;
    if (graph.bare.has(r)) dangling.push({ token: r, referencedBy: "(a component rule)" });
    else knobs.push(r);
  }

  const unused = names.filter((n) => !graph.uses.has(n) && !referencedBy.has(n)).sort();

  const skipsSemantic: TokenReport["skipsSemantic"] = [];
  const inverted: TokenReport["inverted"] = [];
  const seen = new Set<string>();
  for (const d of global) {
    const alias = /^var\(\s*(--[A-Za-z0-9_-]+)/.exec(d.value)?.[1];
    if (!alias || !alias.startsWith(prefix) || seen.has(d.name + alias)) continue;
    seen.add(d.name + alias);
    const from = tierOf(d.name, prefix);
    const to = tierOf(alias, prefix);
    // Colours are where skipping the semantic layer breaks theming; spacing often maps straight to the scale on purpose.
    // util tokens and "transparent" are mode-aware or mode-free by design, so pointing at them is fine.
    if (from === "component" && to === "primitive" && d.name.startsWith(prefix + "color-") && !/-util-|transparent/.test(alias)) {
      skipsSemantic.push({ token: d.name, target: alias, ownDark: graph.defs.some((x) => x.name === d.name && x.scope === "dark") });
    }
    if (from === "semantic" && to === "component") inverted.push({ token: d.name, target: alias });
  }

  let modeAware = 0;
  for (const n of names) {
    const l = resolve(graph, n, "light").value;
    const dk = resolve(graph, n, "dark").value;
    if (l && dk && l !== dk) modeAware++;
  }

  const checks: PairCheck[] = [];
  for (const p of pairs) {
    for (const mode of ["light", "dark"] as const) {
      const t = resolve(graph, p.text, mode).value;
      const b = resolve(graph, p.background, mode).value;
      const s = p.surface ? resolve(graph, p.surface, mode).value : undefined;
      const fg = t ? parseColor(t) : undefined;
      let bg = b ? parseColor(b) : undefined;
      const base = s ? parseColor(s) : mode === "dark" ? [0, 0, 0, 1] : [255, 255, 255, 1];
      if (bg && base && (bg[3] ?? 1) < 1) bg = over(bg, base) as typeof bg;
      const ratio = fg && bg ? Math.round(contrast(fg, bg) * 100) / 100 : undefined;
      checks.push({ label: p.label, mode, text: p.text, background: p.background, textValue: t, backgroundValue: b, ratio, passes: ratio === undefined ? undefined : ratio >= 4.5 });
    }
  }

  return { total: names.length, byTier, modeAware, dangling, knobs: knobs.sort(), unused, skipsSemantic, inverted, pairs: checks };
}
