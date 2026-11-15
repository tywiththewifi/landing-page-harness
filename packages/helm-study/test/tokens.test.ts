import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyze, contrast, parseColor, parseTokens, resolve, tierOf } from "../src/tokens.ts";

const css = readFileSync(new URL("./fixtures/system.css", import.meta.url), "utf8");
const graph = parseTokens([css], { prefix: "--x-", darkClass: ".x-mode--dark", lightClass: ".x-mode--light" });

describe("parseTokens", () => {
  it("keeps :root, light, dark, @layer and @property definitions and drops @media overrides", () => {
    const brand = graph.defs.filter((d) => d.name === "--x-color-core-brand-600");
    expect(brand.map((d) => d.value)).toEqual(["#533afd"]);
    expect(graph.defs.find((d) => d.name === "--x-tabs-gap")?.scope).toBe("scoped");
    expect(graph.defs.find((d) => d.name === "--x-tab-index")?.selector).toBe("@property");
    expect(graph.defs.find((d) => d.name === "--x-color-surface-bg-quiet" && d.scope === "dark")?.value).toBe("var(--x-color-core-neutral-990)");
  });

  it("counts reads from ordinary declarations, and which had no fallback", () => {
    expect(graph.uses.get("--x-color-button-primary-bg")).toBe(1);
    expect(graph.bare.has("--x-color-text-subtle")).toBe(true);
    expect(graph.bare.has("--x-grid-cols")).toBe(false);
  });
});

describe("resolve", () => {
  it("follows aliases through the tiers, including multi-line var()", () => {
    expect(resolve(graph, "--x-color-button-primary-bgHover", "light")).toEqual({
      value: "#4032c8",
      chain: ["--x-color-button-primary-bgHover", "--x-color-action-bg-solidHover", "--x-color-core-brand-700"],
    });
  });

  it("uses the dark definition where there is one and falls back to light", () => {
    expect(resolve(graph, "--x-color-button-primary-bgHover", "dark").value).toBe("#5d64fe");
    expect(resolve(graph, "--x-color-button-primary-bg", "dark").value).toBe("#533afd");
  });

  it("reports the first missing link", () => {
    expect(resolve(graph, "--x-color-text-subtle", "light").missing).toBe("--x-color-text-subtle");
  });
});

describe("tierOf", () => {
  it("sorts names into primitive, semantic and component", () => {
    expect(tierOf("--x-color-core-brand-600", "--x-")).toBe("primitive");
    expect(tierOf("--x-color-action-bg-solid", "--x-")).toBe("semantic");
    expect(tierOf("--x-color-button-primary-bg", "--x-")).toBe("component");
  });
});

describe("analyze", () => {
  const report = analyze(graph, [
    { label: "Primary", text: "--x-color-button-primary-text", background: "--x-color-button-primary-bg" },
    { label: "Hover", text: "--x-color-button-primary-text", background: "--x-color-button-primary-bgHover" },
  ]);

  it("separates undefined tokens read bare from inputs with a fallback", () => {
    expect(report.dangling.map((d) => d.token)).toEqual(["--x-color-text-subtle"]);
    expect(report.knobs).toEqual(["--x-grid-cols"]);
  });

  it("finds tokens nothing reads", () => {
    expect(report.unused).toContain("--x-color-core-unused");
    expect(report.unused).not.toContain("--x-color-core-brand-600");
  });

  it("flags a component colour that skips the semantic layer, and a semantic token that points at a component", () => {
    expect(report.skipsSemantic).toEqual([{ token: "--x-color-input-border", target: "--x-color-core-brand-600", ownDark: false }]);
    expect(report.inverted).toEqual([{ token: "--x-color-text-solid", target: "--x-color-button-primary-text" }]);
  });

  it("checks contrast in both modes", () => {
    const hoverDark = report.pairs.find((p) => p.label === "Hover" && p.mode === "dark")!;
    expect(hoverDark.backgroundValue).toBe("#5d64fe");
    expect(hoverDark.passes).toBe(false);
    expect(report.pairs.find((p) => p.label === "Primary" && p.mode === "light")?.passes).toBe(true);
  });
});

describe("colour", () => {
  it("parses hex with alpha and rgba, and composites over a background", () => {
    expect(parseColor("#4834dbb2")).toEqual([72, 52, 219, 178 / 255]);
    expect(parseColor("rgba(255, 255, 255, 0.65)")).toEqual([255, 255, 255, 0.65]);
    expect(Math.round(contrast([255, 255, 255, 1], [83, 58, 253, 1]) * 100) / 100).toBe(6.19);
  });
});
