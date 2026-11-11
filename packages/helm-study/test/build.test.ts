import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildTokens, COMPONENT_TOKENS, tokensCss } from "../src/build-tokens.ts";
import { loadGraph } from "../src/data.ts";
import { COMPONENTS_CSS, TOKENS_CSS } from "../src/render.tsx";
import { resolve } from "../src/tokens.ts";

const { graph, takenAt } = loadGraph();
const tokens = buildTokens(graph);
const tokensFile = readFileSync(TOKENS_CSS, "utf8");
const componentsFile = readFileSync(COMPONENTS_CSS, "utf8");

describe("generated tokens", () => {
  it("are up to date with the Helm snapshot (run `pnpm --filter @lph/helm-study build`)", () => {
    expect(tokensFile).toBe(tokensCss(tokens, `Helm's tokens as served by stripe.com on ${takenAt.slice(0, 10)}`));
  });

  it("resolve to exactly what Helm's own tokens resolve to, in both modes", () => {
    for (const [mine, helm] of Object.entries(COMPONENT_TOKENS)) {
      const t = tokens.find((x) => x.name === mine)!;
      expect(t, mine).toBeDefined();
      expect(t.resolved.light, mine).toBe(resolve(graph, helm, "light").value);
      expect(t.resolved.dark, mine).toBe(resolve(graph, helm, "dark").value);
    }
  });

  it("keep three tiers: components only point at semantic tokens or primitives, never the other way", () => {
    const tierOf = new Map(tokens.map((t) => [t.name, t.tier]));
    for (const t of tokens) {
      for (const value of [t.light, t.dark ?? ""]) {
        for (const [, ref] of value.matchAll(/var\((--sl-[A-Za-z0-9-]+)/g)) {
          expect(tierOf.get(ref!), `${t.name} → ${ref}`).toBeDefined();
          if (t.tier === "primitive") expect(tierOf.get(ref!), `${t.name} → ${ref}`).toBe("primitive");
          if (t.tier === "semantic") expect(tierOf.get(ref!), `${t.name} → ${ref}`).not.toBe("component");
        }
      }
    }
  });
});

describe("components.css", () => {
  const rules = componentsFile.replace(/\/\*[\s\S]*?\*\//g, "");

  it("has no colour literals: every colour comes from a token", () => {
    expect(rules.match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/gi)).toBeNull();
  });

  it("reads only component tokens or its own named values", () => {
    const own = new Set([...rules.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)].map((m) => m[1]));
    const component = new Set(tokens.filter((t) => t.tier === "component").map((t) => t.name));
    for (const [, ref] of rules.matchAll(/var\((--[A-Za-z0-9_-]+)/g)) {
      expect(component.has(ref!) || own.has(ref!), ref).toBe(true);
    }
  });
});
