import { describe, expect, it } from "vitest";
import { contrastRatio, hueName, isChromatic, normalizeColor, parseColor } from "../src/color.ts";

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
});
