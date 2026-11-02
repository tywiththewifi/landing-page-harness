import { useEffect, useState } from "react";
import type { ColorShare, Logo } from "@lph/tokens";

/**
 * The colours a logo is drawn in, read from its pixels so fills, strokes, gradients and
 * images all count. SVGs are drawn with the tile's text colour, as currentColor. Null while
 * it loads, and for an image whose server doesn't allow reading it (no CORS header).
 */
export function useLogoColors(logo: Logo | null, color: string): ColorShare[] | null {
  const [colors, setColors] = useState<ColorShare[] | null>(null);
  const src = logo?.kind === "svg" && logo.svg ? svgUrl(logo.svg, color) : logo?.kind === "img" ? (logo.src ?? null) : null;
  useEffect(() => {
    setColors(null);
    if (!src) return;
    let live = true;
    void sampleColors(src).then((c) => live && setColors(c));
    return () => {
      live = false;
    };
  }, [src]);
  return colors;
}

/** A standalone SVG file, which needs its namespace and a size to draw as an image. */
function svgUrl(svg: string, color: string): string {
  let open = svg.match(/^<svg\b[^>]*>/i)?.[0] ?? "<svg>";
  const add = (attr: string) => (open = open.replace(/^<svg\b/i, `<svg ${attr}`));
  if (!/\sxmlns=/.test(open)) add('xmlns="http://www.w3.org/2000/svg"');
  // An own colour attribute wins over the tile's, as it does in the page.
  if (!/\scolor=/.test(open)) add(`color="${color}"`);
  if (!/\swidth=/.test(open) && !/\sheight=/.test(open)) {
    const box = open.match(/viewBox="[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)"/);
    const [w, h] = box ? [Number(box[1]), Number(box[2])] : [300, 150];
    add(`width="${(w / h) * 64}" height="64"`);
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/^<svg\b[^>]*>/i, () => open))}`;
}

async function sampleColors(src: string): Promise<ColorShare[] | null> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = src;
  try {
    await img.decode();
    const w = 160;
    const h = Math.max(1, Math.round((w * (img.naturalHeight || 1)) / (img.naturalWidth || 1)));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    // Close shades are counted together; anti-aliased edges are left out.
    const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! < 200) continue;
      const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const s = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
      s.r += r;
      s.g += g;
      s.b += b;
      s.n++;
      buckets.set(key, s);
    }
    const hex = (v: number) => Math.round(v).toString(16).padStart(2, "0");
    return [...buckets.values()].map((s) => ({ color: `#${hex(s.r / s.n)}${hex(s.g / s.n)}${hex(s.b / s.n)}`, weight: s.n }));
  } catch {
    return null; // Didn't load, or the image can't be read across origins.
  }
}
