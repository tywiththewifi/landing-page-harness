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
