import {
  colorDistance,
  contrastRatio,
  hueName,
  isChromatic,
  luminance,
  normalizeColor,
  toHsl,
  type Brand,
  type ButtonStyle,
  type CardStyle,
  type ColorToken,
  type CustomerLogo,
  type Conflict,
  type InputStyle,
  type SizeToken,
  type Source,
  type TypeRole,
  type TypeToken,
} from "@lph/tokens";
import type { BoxSample, PageSample, TextSample } from "./collect.ts";

/** Desktop sample plus, optionally, a mobile-width sample of the same page. */
export interface PageCapture {
  desktop: PageSample;
  mobile?: PageSample;
}

// --- Tallying ----------------------------------------------------------------------

interface Bucket<T> {
  key: string;
  value: T;
  weight: number;
  pages: Set<string>;
  sources: Map<string, Source>;
}

class Tally<T> {
  buckets = new Map<string, Bucket<T>>();

  add(key: string, value: T, weight: number, page: string, selector: string) {
    let b = this.buckets.get(key);
    if (!b) {
      b = { key, value, weight: 0, pages: new Set(), sources: new Map() };
      this.buckets.set(key, b);
    }
    b.weight += weight;
    b.pages.add(page);
    const s = b.sources.get(page);
    if (s) s.count += 1;
    else b.sources.set(page, { page, selector, count: 1 });
  }

  sorted(): Bucket<T>[] {
    return [...this.buckets.values()].sort((a, b) => b.weight - a.weight);
  }

  total(): number {
    let t = 0;
    for (const b of this.buckets.values()) t += b.weight;
    return t;
  }
}

const sourcesOf = (b: Bucket<unknown>) => [...b.sources.values()];
const r2 = (n: number) => Math.round(n * 100) / 100;
const mode = <T>(items: T[], key: (t: T) => string = String): T | undefined => {
  const counts = new Map<string, { item: T; n: number }>();
  for (const it of items) {
    const k = key(it);
    const e = counts.get(k);
    if (e) e.n++;
    else counts.set(k, { item: it, n: 1 });
  }
  return [...counts.values()].sort((a, b) => b.n - a.n)[0]?.item;
};

// --- Colours -----------------------------------------------------------------------

interface ColorObservation {
  hex: string;
  weight: number;
  page: string;
  selector: string;
  kind: "bg" | "text" | "cta" | "border";
  places: string[];
}

/** Merges near-identical colours (anti-aliasing, rounding) into the heavier one. */
function mergeNear(obs: ColorObservation[], threshold = 14): Map<string, string> {
  const weights = new Map<string, number>();
  for (const o of obs) weights.set(o.hex, (weights.get(o.hex) ?? 0) + o.weight);
  const ordered = [...weights.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h);
  const canon = new Map<string, string>();
  const kept: string[] = [];
  for (const hex of ordered) {
    const near = kept.find((k) => colorDistance(k, hex) < threshold);
    canon.set(hex, near ?? hex);
    if (!near) kept.push(hex);
  }
  return canon;
}

function placeLabel(place: string): string {
  return (
    { header: "navigation", footer: "footer", hero: "hero band", button: "buttons", card: "cards", section: "section backgrounds" }[
      place
    ] ?? place
  );
}

/** Share of the sampled page area (in %) a colour must cover to count as a brand band. */
const BAND_AREA = 3;

function analyzeColors(pages: PageCapture[], buttons: ButtonStyle[]) {
  const obs: ColorObservation[] = [];
  for (const { desktop: p } of pages) {
    const docArea = Math.max(1, p.backgrounds.reduce((s, b) => s + b.area, 0));
    for (const b of p.backgrounds) {
      const hex = normalizeColor(b.color);
      if (hex) obs.push({ hex, weight: (b.area / docArea) * 100, page: p.url, selector: b.selector, kind: "bg", places: b.places });
    }
    for (const t of p.texts) {
      const hex = normalizeColor(t.color);
      if (hex) obs.push({ hex, weight: 1, page: p.url, selector: t.selector, kind: "text", places: [] });
    }
    for (const c of p.cards) {
      const hex = normalizeColor(c.borderColor);
      if (hex && c.borderWidth >= 1) obs.push({ hex, weight: 1, page: p.url, selector: c.selector, kind: "border", places: ["card"] });
    }
    for (const i of p.inputs) {
      const hex = normalizeColor(i.borderColor);
      if (hex && i.borderWidth >= 1) obs.push({ hex, weight: 1, page: p.url, selector: i.selector, kind: "border", places: ["input"] });
    }
  }
  for (const b of buttons) {
    const src = b.sources[0]!;
    const hex = b.kind === "filled" ? b.background : b.borderColor ?? b.color;
    if (hex) obs.push({ hex, weight: b.sources.reduce((s, x) => s + x.count, 0), page: src.page, selector: src.selector, kind: "cta", places: ["button"] });
  }

  const canon = mergeNear(obs);
  const byKind = (kind: ColorObservation["kind"]) => {
    const t = new Tally<string>();
    for (const o of obs.filter((o) => o.kind === kind)) {
      const hex = canon.get(o.hex)!;
      t.add(hex, hex, o.weight, o.page, o.selector);
    }
    return t;
  };
  const bg = byKind("bg");
  const text = byKind("text");
  const cta = byKind("cta");
  const border = byKind("border");

  const placesFor = (hex: string) => {
    const set = new Set<string>();
    for (const o of obs) if (canon.get(o.hex) === hex && o.kind === "bg") o.places.forEach((p) => set.add(p));
    return [...set].map(placeLabel);
  };

  const used = new Set<string>();
  const tokens: ColorToken[] = [];
  const push = (hex: string, role: ColorToken["role"], usage: string[], bucket: Bucket<string> | undefined, confidence: number) => {
    if (used.has(hex)) return;
    used.add(hex);
    tokens.push({ name: "", value: hex, role, usage, sources: bucket ? sourcesOf(bucket) : [], confidence: r2(confidence) });
  };

  // Surface: the page background.
  const homeBody = normalizeColor(pages[0]?.desktop.body.bg) ?? "#ffffff";
  const surfaceHex = canon.get(homeBody) ?? homeBody;
  push(surfaceHex, "surface", ["page background"], bg.buckets.get(surfaceHex), 0.95);

  // Brand: a chromatic colour that covers real area (hero, nav or footer bands). Without one,
  // the primary button's colour: a few large secondary buttons on one page shouldn't
  // outrank the main call to action. Tiny chromatic dots (avatars, charts) never count.
  const bgSorted = bg.sorted();
  const chromaticBgs = bgSorted.filter((b) => isChromatic(b.key) && b.key !== surfaceHex);
  const ctaSorted = cta.sorted();
  const primaryCta = buttons.find((b) => b.kind === "filled" && b.background && isChromatic(b.background));
  const primaryCtaHex = primaryCta?.background ? canon.get(primaryCta.background) ?? primaryCta.background : null;
  const brandBucket =
    chromaticBgs.find((b) => b.weight >= BAND_AREA) ??
    (primaryCtaHex ? cta.buckets.get(primaryCtaHex) ?? bg.buckets.get(primaryCtaHex) : undefined) ??
    chromaticBgs.find((b) => b.weight >= 1) ??
    ctaSorted.find((b) => isChromatic(b.key));
  if (brandBucket) {
    // When the brand comes from the buttons, its weight isn't on the bands' scale, so the share is capped.
    const share = Math.min(1, brandBucket.weight / Math.max(1, chromaticBgs.reduce((s, b) => s + b.weight, 0)));
    const usage = placesFor(brandBucket.key);
    push(brandBucket.key, "brand", usage.length ? usage : ["calls to action"], brandBucket, 0.5 + share / 2);
  }

  // Accent: the most-used chromatic CTA colour that isn't the brand colour.
  const accentBucket = ctaSorted.find(
    (b) => isChromatic(b.key) && !used.has(b.key) && (!brandBucket || colorDistance(b.key, brandBucket.key) > 40),
  );
  if (accentBucket) {
    push(accentBucket.key, "accent", ["calls to action", "highlights", ...placesFor(accentBucket.key).filter((p) => p !== "buttons")], accentBucket, Math.min(1, 0.5 + accentBucket.weight / 10));
  }

  // Ink: the most common text colour that reads strongly on the surface. Contrast rather
  // than darkness, so dark-themed sites get their light text as ink.
  const readable = (min: number) => (b: Bucket<string>) => contrastRatio(b.key, surfaceHex) >= min;
  const inkBucket =
    text.sorted().find(readable(7)) ?? text.sorted().find(readable(4.5)) ?? ctaSorted.find(readable(7));
  if (inkBucket) {
    const share = inkBucket.weight / Math.max(1, text.total());
    push(inkBucket.key, "ink", ["body text", "headings", ...(cta.buckets.has(inkBucket.key) ? ["primary buttons"] : [])], inkBucket, 0.5 + share / 2);
  }

  // Other notable colours: chromatic ones become extra brand colours, the rest neutrals.
  const rest = new Tally<string>();
  for (const t of [bg, cta, text, border]) {
    const total = Math.max(1, t.total());
    for (const b of t.sorted()) {
      for (const s of b.sources.values()) rest.add(b.key, b.key, (b.weight / total) / b.sources.size, s.page, s.selector);
    }
  }
  let chromaticExtras = 0;
  let neutrals = 0;
  for (const b of rest.sorted()) {
    if (used.has(b.key)) continue;
    if (isChromatic(b.key)) {
      // A site with no brand colour (monochrome) keeps a neutral palette.
      if (!brandBucket || chromaticExtras >= 2 || b.weight < 0.03) continue;
      chromaticExtras++;
      push(b.key, "brand", placesFor(b.key), b, 0.5);
    } else {
      if (neutrals >= 6 || b.weight < 0.005) continue;
      neutrals++;
      const where = [
        ...(text.buckets.has(b.key) ? ["text"] : []),
        ...(border.buckets.has(b.key) ? ["borders"] : []),
        ...placesFor(b.key),
      ];
      push(b.key, "neutral", where, b, Math.min(0.9, 0.4 + b.weight));
    }
  }

  nameColors(tokens);
  return tokens;
}

/** Deterministic names. A model may rename them later, but never change values. */
export function nameColors(tokens: ColorToken[]) {
  const taken = new Set<string>();
  const unique = (n: string) => {
    let name = n;
    for (let i = 2; taken.has(name); i++) name = `${n}-${i}`;
    taken.add(name);
    return name;
  };
  for (const t of tokens) {
    if (t.role === "surface") t.name = unique(luminance(t.value) > 0.9 ? "surface-white" : "surface");
    else if (t.role === "ink") t.name = unique("ink");
    else if (t.role === "brand") t.name = unique(`${tokens.filter((x) => x.role === "brand").indexOf(t) === 0 ? "primary" : "brand"}-${hueName(t.value)}`);
    else if (t.role === "accent") t.name = unique(`accent-${hueName(t.value)}`);
  }
  const neutral = tokens.filter((t) => t.role === "neutral").sort((a, b) => luminance(b.value) - luminance(a.value));
  for (const t of neutral) {
    const l = toHsl(t.value).l;
    const step = Math.min(950, Math.max(50, Math.round((1 - l) * 20) * 50));
    t.name = unique(`neutral-${step}`);
  }
}

// --- Typography ----------------------------------------------------------------------

function familyTally(pages: PageCapture[], tags: string[]) {
  const t = new Tally<string>();
  for (const { desktop: p } of pages) {
    for (const s of p.texts) if (tags.includes(s.tag)) t.add(s.family, s.family, 1, p.url, s.selector);
  }
  return t;
}

function familyConflict(field: string, label: string, tally: Tally<string>): Conflict | null {
  const sorted = tally.sorted();
  const total = tally.total();
  const second = sorted[1];
  if (!second || second.weight / total < 0.15) return null;
  return {
    id: field,
    field,
    message: `${label} text uses more than one font: ${sorted
      .slice(0, 3)
      .map((b) => `${b.key} (${Math.round((b.weight / total) * 100)}%, on ${[...b.pages].map(shortPath).join(", ")})`)
      .join(" vs ")}. Pick the one that should be canonical.`,
    options: sorted.slice(0, 3).map((b) => ({ value: b.key, sources: sourcesOf(b), share: r2(b.weight / total) })),
    resolved: sorted[0]!.key,
  };
}

const shortPath = (url: string) => {
  try {
    const u = new URL(url);
    return u.pathname === "/" ? "home" : u.pathname;
  } catch {
    return url;
  }
};

function typeToken(role: TypeRole, samples: { s: TextSample; page: string }[], mobile: TextSample[]): TypeToken | null {
  if (!samples.length) return null;
  const sizeMode = mode(samples, (x) => String(Math.round(x.s.size)))!;
  const same = samples.filter((x) => Math.round(x.s.size) === Math.round(sizeMode.s.size));
  const pick = mode(same, (x) => `${x.s.family}|${x.s.weight}|${Math.round(x.s.lineHeight)}|${x.s.letterSpacing}|${x.s.transform}`)!;
  const sources = new Map<string, Source>();
  for (const x of same) {
    const e = sources.get(x.page);
    if (e) e.count++;
    else sources.set(x.page, { page: x.page, selector: x.s.selector, count: 1 });
  }
  const share = same.length / samples.length;
  const coverage = Math.min(1, samples.length / 3);
  const mobileMode = mode(mobile.map((m) => Math.round(m.size)));
  const transform = pick.s.transform as TypeToken["textTransform"];
  return {
    role,
    fontFamily: pick.s.family,
    fontSize: r2(pick.s.size),
    mobileFontSize: mobileMode && mobileMode !== Math.round(pick.s.size) ? mobileMode : undefined,
    fontWeight: pick.s.weight,
    lineHeight: r2(pick.s.lineHeight),
    letterSpacing: r2(pick.s.letterSpacing),
    textTransform: ["none", "uppercase", "lowercase", "capitalize"].includes(transform) ? transform : "none",
    sources: [...sources.values()],
    confidence: r2(0.3 + 0.7 * share * coverage),
  };
}

function analyzeTypography(pages: PageCapture[], buttons: ButtonStyle[]) {
  const headingTally = familyTally(pages, ["h1", "h2", "h3"]);
  const bodyTally = familyTally(pages, ["p", "li"]);
  const heading = headingTally.sorted()[0]?.key ?? pages[0]?.desktop.body.family ?? "system-ui";
  const body = bodyTally.sorted()[0]?.key ?? pages[0]?.desktop.body.family ?? "system-ui";
  const conflicts = [
    familyConflict("fonts.heading", "Heading", headingTally),
    familyConflict("fonts.body", "Body", bodyTally),
  ].filter((c): c is Conflict => !!c);

  const collect = (tags: string[], family?: string) =>
    pages.flatMap(({ desktop: p }) =>
      p.texts.filter((s) => tags.includes(s.tag) && (!family || s.family === family)).map((s) => ({ s, page: p.url })),
    );
  const mobileOf = (tags: string[]) =>
    pages.flatMap(({ mobile }) => (mobile ? mobile.texts.filter((s) => tags.includes(s.tag)) : []));

  const tokens: TypeToken[] = [];
  for (const tag of ["h1", "h2", "h3", "h4"] as const) {
    const t = typeToken(tag, collect([tag]), mobileOf([tag]));
    if (t) tokens.push(t);
  }
  const bodyToken = typeToken("body", collect(["p", "li"], body), mobileOf(["p", "li"]));
  if (bodyToken) tokens.push(bodyToken);
  const smallSamples = collect(["small", "label"]).filter((x) => !bodyToken || x.s.size < bodyToken.fontSize);
  const small = typeToken("small", smallSamples, []);
  if (small) tokens.push(small);

  const primary = buttons.find((b) => b.kind !== "text");
  if (primary) {
    tokens.push({
      role: "label",
      fontFamily: body,
      fontSize: primary.fontSize,
      fontWeight: primary.fontWeight,
      lineHeight: r2(primary.fontSize * 1.25),
      letterSpacing: 0,
      textTransform: primary.textTransform,
      sources: primary.sources,
      confidence: primary.confidence,
    });
  }

  // A display size exists if some heading is clearly larger than the usual h1.
  const h1 = tokens.find((t) => t.role === "h1");
  if (h1) {
    const big = collect(["h1", "h2"]).filter((x) => x.s.size >= h1.fontSize * 1.15);
    const display = big.length ? typeToken("display", big, []) : null;
    if (display) tokens.unshift(display);
  }

  return { fonts: { heading, body }, typography: tokens, conflicts };
}

// --- Buttons, cards, inputs ------------------------------------------------------------

const radiusOf = (b: BoxSample) => (b.radius >= b.height / 2 - 1 && b.height > 0 ? 9999 : Math.round(b.radius));

function analyzeButtons(pages: PageCapture[]): ButtonStyle[] {
  const tally = new Tally<BoxSample & { kind: ButtonStyle["kind"]; r: number }>();
  const fgByKey = new Map<string, Map<string, number>>();
  for (const { desktop: p } of pages) {
    for (const b of p.buttons) {
      const bg = normalizeColor(b.bg);
      const ctx = normalizeColor(b.contextBg) ?? "#ffffff";
      const fg = normalizeColor(b.color, 0.5);
      if (!fg) continue;
      const border = b.borderWidth >= 1 ? normalizeColor(b.borderColor, 0.5) : null;
      const kind: ButtonStyle["kind"] = bg && bg !== ctx ? "filled" : border ? "outline" : "text";
      if (kind === "text") continue;
      const r = radiusOf(b);
      // Text colour is left out of the key: the same button often inherits a different
      // link colour in the nav. The most common text colour wins below.
      const key = [kind, kind === "filled" ? bg : border, r, b.transform].join("|");
      tally.add(key, { ...b, kind, r }, 1, p.url, b.selector);
      const fgs = fgByKey.get(key) ?? new Map<string, number>();
      fgs.set(fg, (fgs.get(fg) ?? 0) + 1);
      fgByKey.set(key, fgs);
    }
  }
  for (const [key, fgs] of fgByKey) {
    const bucket = tally.buckets.get(key)!;
    const top = [...fgs.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    bucket.value = { ...bucket.value, color: top };
  }
  const rows = tally.sorted();
  const filled = rows.filter((b) => b.value.kind === "filled");
  const outline = rows.filter((b) => b.value.kind === "outline");
  // Filled buttons first (by frequency, darker first on ties), then outlines.
  filled.sort((a, b) => b.weight - a.weight || luminance(normalizeColor(a.value.bg)!) - luminance(normalizeColor(b.value.bg)!));
  const ordered = [...filled, ...outline].slice(0, 4);
  const names = ["primary", "secondary", "tertiary", "quaternary"];
  const out: ButtonStyle[] = ordered.map((b, i) => toButton(b, names[i]!, pages.length));

  // One text-link style from links inside running copy.
  const linkTally = new Tally<BoxSample>();
  for (const { desktop: p } of pages) {
    for (const l of p.links) {
      const fg = normalizeColor(l.color);
      if (fg) linkTally.add(`${fg}|${l.fontWeight}`, l, 1, p.url, l.selector);
    }
  }
  const link = linkTally.sorted()[0];
  if (link) {
    out.push({
      name: "link",
      kind: "text",
      background: null,
      color: normalizeColor(link.value.color)!,
      borderColor: null,
      borderWidth: 0,
      radius: 0,
      paddingX: 0,
      paddingY: 0,
      fontSize: link.value.fontSize,
      fontWeight: link.value.fontWeight,
      textTransform: (link.value.transform as ButtonStyle["textTransform"]) ?? "none",
      context: normalizeColor(link.value.contextBg) ?? "#ffffff",
      sampleText: link.value.text,
      sources: sourcesOf(link),
      confidence: r2(Math.min(1, 0.4 + link.weight / 10)),
    });
  }
  return out;
}

function toButton(b: Bucket<BoxSample & { kind: ButtonStyle["kind"]; r: number }>, name: string, pageCount: number): ButtonStyle {
  const v = b.value;
  const transform = v.transform as ButtonStyle["textTransform"];
  return {
    name,
    kind: v.kind,
    background: v.kind === "filled" ? normalizeColor(v.bg) : null,
    color: normalizeColor(v.color, 0.5)!,
    borderColor: v.borderWidth >= 1 ? normalizeColor(v.borderColor, 0.5) : null,
    borderWidth: v.borderWidth >= 1 ? r2(v.borderWidth) : 0,
    radius: v.r,
    paddingX: Math.round(v.paddingX),
    paddingY: Math.round(v.paddingY),
    fontSize: r2(v.fontSize),
    fontWeight: v.fontWeight,
    textTransform: ["none", "uppercase", "lowercase", "capitalize"].includes(transform) ? transform : "none",
    context: normalizeColor(v.contextBg) ?? "#ffffff",
    sampleText: v.text,
    sources: sourcesOf(b),
    confidence: r2(Math.min(1, 0.35 + 0.15 * b.weight + 0.2 * (b.pages.size / pageCount))),
  };
}

function analyzeCards(pages: PageCapture[]): CardStyle[] {
  const tally = new Tally<BoxSample>();
  for (const { desktop: p } of pages) {
    for (const c of p.cards) {
      const bg = normalizeColor(c.bg) ?? normalizeColor(c.contextBg) ?? "#ffffff";
      const border = c.borderWidth >= 1 ? normalizeColor(c.borderColor, 0.3) : null;
      const shadow = c.shadow && c.shadow !== "none";
      const key = [bg, border, Math.round(c.radius), shadow ? "shadow" : ""].join("|");
      tally.add(key, c, 1, p.url, c.selector);
    }
  }
  const taken = new Set<string>();
  return tally
    .sorted()
    .filter((b) => b.weight >= 2 || b.pages.size > 1)
    .slice(0, 5)
    .map((b, i) => {
      const v = b.value;
      const bg = normalizeColor(v.bg) ?? normalizeColor(v.contextBg) ?? "#ffffff";
      const border = v.borderWidth >= 1 ? normalizeColor(v.borderColor, 0.3) : null;
      const shadow = v.shadow && v.shadow !== "none" ? v.shadow : null;
      let name = i === 0 ? "default" : shadow ? "elevated" : border ? "outlined" : "filled";
      for (let n = 2; taken.has(name); n++) name = `${name.replace(/-\d+$/, "")}-${n}`;
      taken.add(name);
      return {
        name,
        background: bg,
        borderColor: border,
        borderWidth: border ? r2(v.borderWidth) : 0,
        radius: Math.round(v.radius),
        shadow,
        padding: Math.round(v.paddingY || v.paddingX),
        context: normalizeColor(v.contextBg) ?? "#ffffff",
        sources: sourcesOf(b),
        confidence: r2(Math.min(1, 0.35 + 0.1 * b.weight + 0.2 * (b.pages.size / pages.length))),
      };
    });
}

export function analyzeInput(pages: PageCapture[]): InputStyle | null {
  const tally = new Tally<BoxSample>();
  for (const { desktop: p } of pages) {
    for (const i of p.inputs) {
      // A field set in display type (Frontify's 96px newsletter signup) is a one-off, not the form style.
      if (i.fontSize > 24) continue;
      // Nor is a bare field inside a box something else draws (the header searches on Frontify and Cosuno).
      if (i.borderWidth < 1 && (!normalizeColor(i.bg) || normalizeColor(i.bg) === normalizeColor(i.contextBg))) continue;
      const key = [normalizeColor(i.bg), normalizeColor(i.borderColor, 0.3), Math.round(i.radius)].join("|");
      tally.add(key, i, 1, p.url, i.selector);
    }
  }
  const top = tally.sorted()[0];
  if (!top) return null;
  const v = top.value;
  return {
    background: normalizeColor(v.bg) ?? normalizeColor(v.contextBg) ?? "#ffffff",
    color: normalizeColor(v.color) ?? "#111111",
    borderColor: v.borderWidth >= 1 ? normalizeColor(v.borderColor, 0.3) : null,
    borderWidth: v.borderWidth >= 1 ? r2(v.borderWidth) : 0,
    radius: Math.round(v.radius),
    paddingX: Math.round(v.paddingX),
    paddingY: Math.round(v.paddingY),
    fontSize: r2(v.fontSize),
    sources: sourcesOf(top),
    confidence: r2(Math.min(1, 0.4 + 0.15 * top.weight)),
  };
}

// --- Scales ------------------------------------------------------------------------------

function analyzeRadii(buttons: ButtonStyle[], cards: CardStyle[], input: InputStyle | null): SizeToken[] {
  const tally = new Tally<number>();
  const add = (value: number, sources: Source[]) => {
    if (value <= 0) return;
    for (const s of sources) tally.add(String(value), value, s.count, s.page, s.selector);
  };
  for (const b of buttons) if (b.kind !== "text") add(b.radius, b.sources);
  for (const c of cards) add(c.radius, c.sources);
  if (input) add(input.radius, input.sources);
  const total = Math.max(1, tally.total());
  const values = tally.sorted().map((b) => b).sort((a, b) => a.value - b.value);
  const names = ["sm", "md", "lg", "xl", "2xl", "3xl"];
  let i = 0;
  return values.map((b) => ({
    name: b.value >= 9999 ? "pill" : names[i++] ?? `r${b.value}`,
    value: b.value,
    sources: sourcesOf(b),
    confidence: r2(Math.min(1, 0.4 + b.weight / total)),
  }));
}

function analyzeSpacing(pages: PageCapture[], buttons: ButtonStyle[], cards: CardStyle[]): SizeToken[] {
  const tally = new Tally<number>();
  for (const { desktop: p } of pages) {
    for (const n of p.spacing) {
      const v = Math.round(n);
      if (v >= 4) tally.add(String(v), v, 1, p.url, "layout padding/gap");
    }
  }
  for (const b of buttons) for (const v of [b.paddingX, b.paddingY]) if (v >= 4) tally.add(String(v), v, 1, b.sources[0]!.page, "button padding");
  for (const c of cards) if (c.padding >= 4) tally.add(String(c.padding), c.padding, 1, c.sources[0]!.page, "card padding");
  const top = tally
    .sorted()
    .filter((b) => b.weight >= 2)
    .slice(0, 8)
    .sort((a, b) => a.value - b.value);
  const names = ["2xs", "xs", "sm", "md", "lg", "xl", "2xl", "3xl"];
  const total = Math.max(1, top.reduce((s, b) => s + b.weight, 0));
  return top.map((b, i) => ({
    name: names[i]!,
    value: b.value,
    sources: sourcesOf(b),
    confidence: r2(Math.min(1, 0.4 + (b.weight / total) * 2)),
  }));
}

// --- Rules and summary -------------------------------------------------------------------------

function isSentenceCase(text: string): boolean {
  const words = text.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w));
  if (words.length < 2) return true;
  return words.slice(1).every((w) => w[0] === w[0]!.toLowerCase() || w === w.toUpperCase());
}

function usageRules(brand: Omit<Brand, "usageRules" | "summary">): string[] {
  const rules: string[] = [];
  const btns = brand.buttons.filter((b) => b.kind !== "text");
  if (btns.length) {
    const radii = [...new Set(btns.map((b) => b.radius))];
    const pill = radii.includes(9999);
    const corner = radii.filter((r) => r < 9999);
    const transforms = new Set(btns.map((b) => b.textTransform));
    const sentence = btns.every((b) => isSentenceCase(b.sampleText));
    rules.push(
      [
        `Buttons use ${corner.length ? corner.map((r) => `${r}px`).join("/") + " rounded corners" : "pill shapes"}`,
        pill && corner.length ? "; one variant is a pill" : !pill ? ", never a pill" : "",
        transforms.has("uppercase") ? ", with uppercase labels." : sentence ? ", with sentence-case labels, never uppercase." : ".",
      ].join(""),
    );
    const outline = btns.find((b) => b.kind === "outline");
    if (outline) rules.push(`The outline button ("${outline.name}") is used on ${outline.context} backgrounds.`);
  }
  const h = brand.typography.find((t) => t.role === "h1");
  const body = brand.typography.find((t) => t.role === "body");
  if (h && body) {
    rules.push(
      `Headings use ${brand.fonts.heading} at weight ${h.fontWeight}${h.letterSpacing < 0 ? " with tight negative tracking" : ""}; body text uses ${brand.fonts.body} at ${body.fontSize}px/${body.lineHeight}px.`,
    );
  }
  const small = brand.typography.find((t) => t.role === "small");
  if (small?.textTransform === "uppercase") {
    rules.push(`Small labels (eyebrows) are uppercase, ${small.fontSize}px, with ${small.letterSpacing}px letter spacing.`);
  }
  const brandColor = brand.colors.find((c) => c.role === "brand");
  if (brandColor && brandColor.usage.length) {
    rules.push(`Use ${brandColor.name} (${brandColor.value}) for ${brandColor.usage.join(", ")}.`);
  }
  const accent = brand.colors.find((c) => c.role === "accent");
  if (accent) rules.push(`Reserve ${accent.name} (${accent.value}) for calls to action and highlights.`);
  const chromatic = brand.colors.filter((c) => isChromatic(c.value));
  if (chromatic.length && chromatic.every((c) => {
    const hue = toHsl(c.value).h;
    return hue >= 60 && hue <= 300;
  })) {
    rules.push("There are no warm colours (reds, oranges, yellows) in the palette.");
  }
  const card = brand.cards[0];
  if (card) {
    rules.push(
      `Cards use ${card.radius}px corners and ${card.padding}px padding${card.borderColor ? `, with a ${card.borderWidth}px ${card.borderColor} border` : ""}${card.shadow ? " and a drop shadow" : card.borderColor ? " and no shadow" : ""}.`,
    );
  }
  return rules;
}

function summarize(brand: Omit<Brand, "usageRules" | "summary">): string {
  const brandColor = brand.colors.find((c) => c.role === "brand");
  const accent = brand.colors.find((c) => c.role === "accent");
  const btn = brand.buttons.find((b) => b.kind !== "text");
  const parts = [
    brandColor ? `${hueName(brandColor.value)}-led palette (${brandColor.value})` : "neutral palette",
    accent ? `with a ${hueName(accent.value)} accent (${accent.value})` : "",
  ].filter(Boolean);
  return `${brand.name}'s visual system: a ${parts.join(" ")}, ${brand.fonts.heading} for headings and ${brand.fonts.body} for body text${
    btn ? `, and ${btn.radius >= 9999 ? "pill-shaped" : `${btn.radius}px rounded`} buttons` : ""
  }.`;
}

// --- Entry point ----------------------------------------------------------------------------------

export function brandName(home: PageSample): string {
  // Titles and some og:site_name values carry a tagline: "Webflow: The agentic web platform".
  const split = (s: string) => s.split(/\s[|–—-]\s|:\s|\s·\s/).map((p) => p.trim()).filter(Boolean);
  const site = split(home.siteName ?? "");
  if (site.length === 1) return site[0]!;
  const host = new URL(home.url).hostname.replace(/^www\./, "");
  const parts = [...site, ...split(home.title)];
  const hostWord = host.split(".")[0]!.toLowerCase();
  const match = parts.find((p) => p.toLowerCase().replace(/\s+/g, "").includes(hostWord));
  if (match) return match;
  if (home.logo?.text && home.logo.text.length < 30) return home.logo.text;
  return hostWord.charAt(0).toUpperCase() + hostWord.slice(1);
}

/** The logo strips the pages show, once per name, without the brand's own. */
export function customersOf(pages: PageCapture[], brand: string): CustomerLogo[] {
  const out = new Map<string, CustomerLogo>();
  const key = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  for (const { desktop: p } of pages) {
    for (const l of p.customerLogos ?? []) {
      if (!key(l.name) || key(l.name) === key(brand) || out.has(key(l.name))) continue;
      out.set(key(l.name), { name: l.name, ...(l.svg ? { svg: l.svg } : { src: l.src }), source: { page: p.url, selector: l.selector, count: 1 } });
    }
  }
  return [...out.values()].slice(0, 16);
}

export function analyze(pages: PageCapture[], opts: { id: string; now?: Date }): Brand {
  const home = pages[0]!.desktop;
  const now = (opts.now ?? new Date()).toISOString();
  const buttons = analyzeButtons(pages);
  const cards = analyzeCards(pages);
  const input = analyzeInput(pages);
  const colors = analyzeColors(pages, buttons);
  const { fonts, typography, conflicts } = analyzeTypography(pages, buttons);
  const declaredVariables = Object.assign({}, ...pages.map((p) => p.desktop.rootVars)) as Record<string, string>;

  const warnings: string[] = [];
  if (!home.logo) warnings.push("No logo found in the site header. Add it manually.");
  if (pages.length < 2) warnings.push("Only the home page was sampled, so values are less certain.");
  if (!buttons.some((b) => b.kind !== "text")) warnings.push("No button styles were detected.");

  const draft: Omit<Brand, "usageRules" | "summary"> = {
    id: opts.id,
    name: brandName(home),
    url: home.url,
    pages: pages.map((p) => p.desktop.url),
    createdAt: now,
    updatedAt: now,
    logo: home.logo
      ? {
          kind: home.logo.kind,
          svg: home.logo.svg,
          src: home.logo.src,
          text: home.logo.text,
          source: { page: home.url, selector: home.logo.selector, count: 1 },
        }
      : null,
    fonts,
    colors,
    typography,
    radii: analyzeRadii(buttons, cards, input),
    spacing: analyzeSpacing(pages, buttons, cards),
    buttons,
    cards,
    input,
    conflicts,
    warnings,
    declaredVariables,
    fontSources: {
      faces: [...new Set(pages.flatMap((p) => p.desktop.fontFaces ?? []))],
      stylesheets: [...new Set(pages.flatMap((p) => p.desktop.fontStylesheets ?? []))],
    },
    customers: customersOf(pages, brandName(home)),
    content: pages.map(({ desktop: p }) => ({ url: p.url, title: p.title, ...p.content })),
  };
  return { ...draft, usageRules: usageRules(draft), summary: summarize(draft) };
}
