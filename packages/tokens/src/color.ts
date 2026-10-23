export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clamp = (n: number, lo = 0, hi = 255) => Math.min(hi, Math.max(lo, n));

/** Parses the colour formats getComputedStyle returns (rgb/rgba) plus hex. */
export function parseColor(input: string | null | undefined): Rgba | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  if (s === "transparent" || s === "none") return null;

  const hex = s.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }

  const fn = s.match(/^rgba?\(([^)]+)\)$/);
  if (fn) {
    const parts = fn[1]!.split(/[\s,/]+/).filter(Boolean);
    const [r, g, b] = parts.slice(0, 3).map(Number);
    const aRaw = parts[3];
    const a = aRaw === undefined ? 1 : aRaw.endsWith("%") ? parseFloat(aRaw) / 100 : Number(aRaw);
    if ([r, g, b, a].some((v) => v === undefined || Number.isNaN(v))) return null;
    return { r: clamp(r!), g: clamp(g!), b: clamp(b!), a: clamp(a, 0, 1) };
  }
  return null;
}

export function toHex({ r, g, b }: Rgba): string {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

/** Normalises any supported colour to #rrggbb, or null if missing or mostly transparent. */
export function normalizeColor(input: string | null | undefined, minAlpha = 0.9): string | null {
  const c = parseColor(input);
  if (!c || c.a < minAlpha) return null;
  return toHex(c);
}

export function toHsl(hex: string): { h: number; s: number; l: number } {
  const c = parseColor(hex)!;
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

/** max - min channel, 0..1. Unlike HSL saturation it stays low for pale tints. */
export function chroma(hex: string): number {
  const c = parseColor(hex)!;
  return (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) / 255;
}

/**
 * "Is this a colour or a grey" test. Uses chroma, so dark brand greens count
 * as colours while pale tinted neutrals (sage, slate) count as greys.
 */
export function isChromatic(hex: string): boolean {
  const { l } = toHsl(hex);
  if (l < 0.06 || l > 0.97) return false;
  return chroma(hex) >= 0.1;
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const c = parseColor(hex)!;
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** WCAG 2.x contrast ratio, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** A colour in a drawing and how much of it there is, in pixels say. */
export interface ColorShare {
  color: string;
  weight: number;
}

/**
 * How well a drawing such as a logo, sampled as colour shares, stands out on a background:
 * the share of it that reaches 3:1, WCAG's minimum for graphics, and the contrast of its
 * main colour. Genki's red wordmark on a band of the same red keeps only its leaf.
 */
export function drawingContrast(colors: ColorShare[], background: string, min = 3): { share: number; main: number } {
  const total = colors.reduce((n, c) => n + c.weight, 0);
  if (!total) return { share: 1, main: 21 };
  const main = colors.reduce((a, b) => (b.weight > a.weight ? b : a));
  const visible = colors.filter((c) => contrastRatio(c.color, background) >= min).reduce((n, c) => n + c.weight, 0);
  return { share: visible / total, main: contrastRatio(main.color, background) };
}

/** Euclidean distance in RGB, weighted towards how people perceive it ("redmean"). */
export function colorDistance(a: string, b: string): number {
  const x = parseColor(a)!;
  const y = parseColor(b)!;
  const rm = (x.r + y.r) / 2;
  const dr = x.r - y.r;
  const dg = x.g - y.g;
  const db = x.b - y.b;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

/** A plain-English hue name for token naming, e.g. "green", "lime", "navy". */
export function hueName(hex: string): string {
  const { h, s, l } = toHsl(hex);
  if (s < 0.12) {
    if (l < 0.15) return "ink";
    if (l > 0.94) return "white";
    return "grey";
  }
  const dark = l < 0.3;
  if (h < 15 || h >= 345) return dark ? "maroon" : "red";
  if (h < 40) return dark ? "brown" : "orange";
  if (h < 65) return "yellow";
  if (h < 95) return "lime";
  if (h < 170) return "green";
  if (h < 195) return "teal";
  if (h < 215) return dark ? "navy" : "sky";
  if (h < 250) return dark ? "navy" : "blue";
  if (h < 290) return "purple";
  return "pink";
}
