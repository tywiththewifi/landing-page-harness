import { describe, expect, it } from "vitest";
import { contrastRatio, drawingContrast, hueName, isChromatic, normalizeColor, parseColor } from "../src/color.ts";

describe("colour utilities", () => {
  it("parses the formats getComputedStyle returns", () => {
    expect(parseColor("rgb(26, 62, 53)")).toEqual({ r: 26, g: 62, b: 53, a: 1 });
    expect(parseColor("rgba(0, 0, 0, 0)")?.a).toBe(0);
    expect(parseColor("rgb(26 62 53 / 50%)")?.a).toBe(0.5);
    expect(parseColor("#abc")).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    expect(parseColor("transparent")).toBeNull();
  });

  it("drops mostly transparent colours when normalising", () => {
    expect(normalizeColor("rgb(26, 62, 53)")).toBe("#1a3e35");
    expect(normalizeColor("rgba(26, 62, 53, 0.08)")).toBeNull();
  });

  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
  });

  it("treats dark brand greens as colours and pale tints as neutrals", () => {
    expect(isChromatic("#1a3e35")).toBe(true);
    expect(isChromatic("#c6f29d")).toBe(true);
    expect(isChromatic("#ecf5f1")).toBe(false);
    expect(isChromatic("#5b6b65")).toBe(false);
    expect(hueName("#1a3e35")).toBe("green");
    expect(hueName("#c6f29d")).toBe("lime");
  });

  it("finds a logo that gets lost on a background", () => {
    // Genki: a red wordmark with a small green leaf.
    const genki = [
      { color: "#ff3e3e", weight: 90 },
      { color: "#8dc63f", weight: 10 },
    ];
    const onRed = drawingContrast(genki, "#ff3e3e");
    expect(onRed.share).toBeCloseTo(0, 5);
    expect(onRed.main).toBeCloseTo(1, 5);
    expect(drawingContrast(genki, "#ffffff").share).toBeCloseTo(0.9, 5);
    expect(drawingContrast(genki, "#ffffff").main).toBeGreaterThan(3);
    expect(drawingContrast([], "#ffffff")).toEqual({ share: 1, main: 21 });
  });
});

describe("replaceColor", async () => {
  const { replaceColor } = await import("../src/edit.ts");
  it("updates every component and rule that used the old value", () => {
    const brand = {
      colors: [{ name: "accent-lime", value: "#c6f29d" }],
      buttons: [{ background: "#c6f29d", color: "#111111", borderColor: null, context: "#ffffff" }],
      cards: [],
      input: null,
      summary: "A lime accent (#C6F29D).",
      usageRules: ["Reserve accent-lime (#c6f29d) for calls to action."],
    } as never;
    const next = replaceColor(brand, "#c6f29d", "#b8f07a") as typeof brand & Record<string, any>;
    expect(next.colors[0].value).toBe("#b8f07a");
    expect(next.buttons[0].background).toBe("#b8f07a");
    expect(next.buttons[0].color).toBe("#111111");
    expect(next.summary).toBe("A lime accent (#b8f07a).");
    expect(next.usageRules[0]).toContain("#b8f07a");
  });
});

describe("semanticColors", async () => {
  const { semanticColors } = await import("../src/output.ts");
  const color = (name: string, value: string, role: string, usage: string[] = []) => ({ name, value, role, usage, sources: [], confidence: 1 });
  const brand = (over: Record<string, unknown> = {}) =>
    ({
      colors: [color("surface", "#ffffff", "surface"), color("ink", "#000000", "ink"), color("orange", "#f54e00", "brand"), color("grey-50", "#f7f7f7", "neutral"), color("grey-500", "#757575", "neutral", ["text"]), color("grey-600", "#616161", "neutral", ["text"])],
      buttons: [{ kind: "filled", background: "#f54e00", color: "#ffffff" }],
      cards: [],
      ...over,
    }) as unknown as Parameters<typeof semanticColors>[0];

  it("keeps muted text readable on subtle bands and cards, not just the surface", () => {
    // #757575 passes on white (4.6:1) but not on the #f7f7f7 subtle band (4.3:1).
    expect(semanticColors(brand()).muted).toBe("#616161");
  });

  it("uses the site's text colour on the brand only when body text can be read in it", () => {
    // White on PostHog orange is 3.5:1: fine on a bold button, not for a hero's paragraph.
    expect(semanticColors(brand()).onBrand).toBe("#000000");
    const readable = brand({ colors: [color("surface", "#ffffff", "surface"), color("ink", "#111111", "ink"), color("navy", "#0d1738", "brand")], buttons: [{ kind: "filled", background: "#0d1738", color: "#e0e7ff" }] });
    expect(semanticColors(readable).onBrand).toBe("#e0e7ff");
  });

  it("puts the surface on the brand band of a monochrome dark site", () => {
    // No brand colour, so the band is the light ink; white on it would be invisible.
    const dark = brand({ colors: [color("surface", "#08090a", "surface"), color("ink", "#f7f8f8", "ink")], buttons: [] });
    expect(semanticColors(dark)).toMatchObject({ brand: "#f7f8f8", onBrand: "#08090a" });
  });
});
