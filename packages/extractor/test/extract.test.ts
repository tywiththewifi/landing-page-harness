import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateDesignMd } from "@lph/design-md";
import { brandKitFiles } from "@lph/kit";
import { checkContrast, resolveConflict, toCss, toDtcg, type Brand } from "@lph/tokens";
import { serveFixture } from "../../../scripts/serve-fixture.mjs";
import { extractBrand, pickProductPage } from "../src/extract.ts";

describe("pickProductPage", () => {
  it("prefers product-like links and skips pricing, blog and auth pages", () => {
    const links = [
      { href: "https://x.com/pricing", text: "Pricing" },
      { href: "https://x.com/blog", text: "Blog" },
      { href: "https://x.com/login", text: "Log in" },
      { href: "https://x.com/customers", text: "Customers" },
      { href: "https://x.com/platform", text: "Platform" },
      { href: "https://other.com/product", text: "Product" },
    ];
    expect(pickProductPage(links, "https://x.com/")).toBe("https://x.com/platform");
  });

  it("returns null when nothing qualifies", () => {
    expect(pickProductPage([{ href: "https://x.com/pricing", text: "Pricing" }], "https://x.com/")).toBeNull();
  });
});

// Extracts the Northloop fixture site in a real browser.
describe("extractBrand (fixture site)", () => {
  let site: { url: string; close: () => Promise<void> };
  let brand: Brand;

  beforeAll(async () => {
    site = await serveFixture({ name: "northloop" });
    brand = await extractBrand({ url: site.url });
  });
  afterAll(() => site?.close());

  const color = (role: string) => brand.colors.find((c) => c.role === role)?.value;

  it("samples the home page and discovers the product page", () => {
    expect(brand.name).toBe("Northloop");
    expect(brand.pages).toEqual([site.url, `${site.url}platform.html`]);
  });

  it("finds the brand palette by role", () => {
    expect(color("surface")).toBe("#ffffff");
    expect(color("brand")).toBe("#1a3e35");
    expect(color("accent")).toBe("#c6f29d");
    expect(color("ink")).toBe("#212526");
    expect(brand.colors.find((c) => c.role === "brand")?.name).toBe("primary-green");
    const neutrals = brand.colors.filter((c) => c.role === "neutral").map((c) => c.value);
    expect(neutrals).toEqual(expect.arrayContaining(["#dfe7e3", "#5b6b65"]));
  });

  it("measures typography, including mobile sizes", () => {
    expect(brand.fonts.heading).toBe("Archivo");
    expect(brand.fonts.body).toBe("Plus Jakarta Sans");
    const h1 = brand.typography.find((t) => t.role === "h1")!;
    expect(h1).toMatchObject({ fontSize: 64, fontWeight: 600, lineHeight: 68, letterSpacing: -1.5, mobileFontSize: 40 });
    const small = brand.typography.find((t) => t.role === "small")!;
    expect(small).toMatchObject({ fontSize: 14, textTransform: "uppercase" });
  });

  it("flags the legacy product page's body font as a conflict", () => {
    const conflict = brand.conflicts.find((c) => c.field === "fonts.body");
    expect(conflict?.options.map((o) => o.value)).toEqual(["Plus Jakarta Sans", "Inter"]);
    const resolved = resolveConflict(brand, conflict!.id, "Inter");
    expect(resolved.fonts.body).toBe("Inter");
    expect(resolved.typography.find((t) => t.role === "body")?.fontFamily).toBe("Inter");
    expect(resolved.typography.find((t) => t.role === "h1")?.fontFamily).toBe("Archivo");
  });

  it("groups buttons into variants with their real radius and colours", () => {
    const [primary, secondary, tertiary] = brand.buttons;
    expect(primary).toMatchObject({ name: "primary", kind: "filled", background: "#212526", radius: 12 });
    expect(secondary).toMatchObject({ name: "secondary", kind: "filled", background: "#c6f29d", color: "#1b2a22" });
    expect(tertiary).toMatchObject({ name: "tertiary", kind: "outline", borderColor: "#c6f29d" });
    expect(brand.buttons.at(-1)).toMatchObject({ name: "link", kind: "text" });
  });

  it("finds card styles, inputs, radii and the logo", () => {
    expect(brand.cards.map((c) => [c.name, c.radius, c.borderColor, !!c.shadow])).toEqual([
      ["default", 16, "#dfe7e3", false],
      ["elevated", 16, null, true],
    ]);
    expect(brand.input).toMatchObject({ radius: 10, borderColor: "#a7b8b0" });
    expect(brand.radii.map((r) => r.value)).toEqual([10, 12, 16]);
    expect(brand.logo?.kind).toBe("svg");
    expect(brand.logo?.svg).not.toMatch(/<script|onload=/i);
  });

  it("records provenance for every token", () => {
    for (const t of [...brand.colors, ...brand.typography, ...brand.buttons, ...brand.cards]) {
      expect(t.sources.length).toBeGreaterThan(0);
      expect(t.confidence).toBeGreaterThan(0);
      expect(t.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("writes rules from measurements only", () => {
    expect(brand.usageRules).toContain("Buttons use 12px rounded corners, never a pill, with sentence-case labels, never uppercase.");
    expect(brand.summary).toContain("#1a3e35");
  });

  it("produces CSS variables, DTCG tokens and a Design.md that agree", async () => {
    const css = toCss(brand);
    expect(css).toContain("--color-primary-green: #1a3e35;");
    expect(css).toContain("--color-brand: #1a3e35;");
    expect(css).toContain("--text-h1-size: 64px;");
    expect(css).toMatch(/@media \(max-width: 600px\)[\s\S]*--text-h1-size: 40px;/);
    expect(css).toContain(".lph-button--primary {");
    const dtcg = toDtcg(brand) as { color: Record<string, { $value: string }> };
    expect(dtcg.color["accent-lime"]?.$value).toBe("#c6f29d");
    const md = generateDesignMd(brand);
    expect(md).toContain("# Northloop design system");
    expect(md).not.toContain("undefined");
    expect(checkContrast(brand).every((c) => c.level !== "fail")).toBe(true);
    const files = (await brandKitFiles(brand)).map((f) => f.path);
    expect(files).toEqual(["tokens.css", "tokens.json", "DESIGN.md", "brand.json", "preview.html", "logo.svg"]);
  });
});
