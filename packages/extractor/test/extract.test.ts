import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateDesignMd } from "@lph/design-md";
import { brandKitFiles } from "@lph/kit";
import { checkContrast, resolveConflict, toCss, toDtcg, type Brand } from "@lph/tokens";
import { serveFixture } from "../../../scripts/serve-fixture.mjs";
import { analyzeInput, brandName, type PageCapture } from "../src/analyze.ts";
import { extractBrand, pickProductPage } from "../src/extract.ts";
import type { PageSample } from "../src/collect.ts";

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

describe("analyzeInput", () => {
  const field = (bg: string, fontSize: number) => ({ bg, color: "#111111", borderColor: "#cccccc", borderWidth: 1, radius: 8, paddingX: 12, paddingY: 10, fontSize, selector: "input", contextBg: "#ffffff" });
  const pages = (inputs: unknown[]) => [{ desktop: { url: "https://x.com/", inputs } }] as unknown as PageCapture[];

  it("skips fields that aren't the form style", () => {
    // Frontify's newsletter signup: a 96px field on black, twice, against one ordinary field.
    expect(analyzeInput(pages([field("#111110", 96), field("#111110", 96), field("#ffffff", 16)]))?.background).toBe("#ffffff");
    expect(analyzeInput(pages([field("#111110", 96)]))).toBeNull();
    // A bare search field: no border, and the same colour as the box around it.
    expect(analyzeInput(pages([{ ...field("#ffffff", 14), borderWidth: 0, paddingX: 30 }]))).toBeNull();
    expect(analyzeInput(pages([{ ...field("#f4f6fb", 16), borderWidth: 0 }]))?.background).toBe("#f4f6fb");
  });
});

describe("brandName", () => {
  const sample = (url: string, title: string, siteName: string | null = null) => ({ url, title, siteName, logo: null }) as unknown as PageSample;

  it("drops the tagline from the title or og:site_name", () => {
    expect(brandName(sample("https://webflow.com/", "Webflow: Build a website", "Webflow: The agentic web platform for modern businesses"))).toBe("Webflow");
    expect(brandName(sample("https://stripe.com/", "Stripe | Financial Infrastructure to Grow Your Revenue"))).toBe("Stripe");
    expect(brandName(sample("https://linear.app/", "Linear – Plan and build products", "Linear"))).toBe("Linear");
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

  it("reads a hover-roll button's label once, in the colour it shows", () => {
    // The hero's "Start free" stacks a clipped second label, and its colour is on the spans.
    expect(brand.buttons.map((b) => b.sampleText)).not.toContain("Start free Start free");
    expect(brand.buttons.find((b) => b.name === "secondary")).toMatchObject({ sampleText: "Start free", color: "#1b2a22" });
  });

  it("reads a button drawn by a wrapper inside the link", () => {
    // <a class="plain"><div class="btn btn--primary">Start free</div></a>
    expect(brand.buttons.find((b) => b.name === "primary")?.sources.some((s) => s.selector.includes("div.btn"))).toBe(true);
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

  it("finds the customer logo strip, with names from the markup", () => {
    const logos = brand.customers ?? [];
    expect(logos.map((l) => l.name)).toEqual(["Halcyon", "Brightwave", "Ferro", "Tallyho", "Orbit"]);
    // A one-colour drawing follows the text colour around it, even one the site coloured with a class.
    expect(logos[0]!.svg).toMatch(/fill="currentColor"/);
    // A <use> brings the sprite's shapes with it.
    expect(logos[1]!.svg).toMatch(/<symbol id="brightwave"/);
    expect(logos[2]!.src).toMatch(/\/logos\/ferro-logo-dark\.svg$/);
    expect(logos.every((l) => !/<script|onload=/i.test(l.svg ?? ""))).toBe(true);
    expect(logos[0]!.source.page).toBe(brand.url);
  });

  it("ignores cookie banners", () => {
    const values = brand.colors.map((c) => c.value);
    expect(values).not.toContain("#ff00aa");
    expect(values).not.toContain("#ffd400");
    expect(brand.buttons.map((b) => b.sampleText)).not.toContain("Accept all");
  });

  it("unhashes build-tool font names and drops their local() fallbacks", () => {
    expect(brand.fontSources.faces.some((f) => f.includes('font-family: "Archivo"'))).toBe(true);
    expect(brand.fontSources.faces.join("\n")).not.toMatch(/3f9a1c2b7d|fallback/);
  });

  it("captures the site's copy for grounding briefs, without the cookie banner", () => {
    const home = brand.content![0]!;
    expect(home.description).toContain("ship workflows in days");
    expect(home.headings[0]).toEqual({ level: 1, text: "Automate the work between your tools" });
    expect(home.headings.map((h) => h.text)).toContain("99.95% uptime");
    expect(home.paragraphs.join(" ")).not.toMatch(/cookies/i);
    expect(home.ctas.slice(0, 2).sort()).toEqual(["Book a demo", "Start free"]);
    expect(brand.content).toHaveLength(2);
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

// Linux answers on all of 127.0.0.0/8, so 127.0.0.2 stands in for an internal address.
// macOS only answers on 127.0.0.1 unless aliased, so these skip there.
describe("extractBrand with allowAddress", () => {
  const servers: ReturnType<typeof createServer>[] = [];
  const listen = async (host: string, handler: Parameters<typeof createServer>[1]) => {
    const server = createServer(handler).listen(0, host);
    servers.push(server);
    await once(server, "listening");
    return `http://${host}:${(server.address() as AddressInfo).port}`;
  };
  afterAll(() => servers.forEach((s) => s.close()));
  const allowAddress = (ip: string) => ip !== "127.0.0.2";

  it("stops at a bot check instead of measuring it", async () => {
    const check = await listen("127.0.0.1", (_, res) =>
      res.writeHead(403, { "content-type": "text/html" }).end(`<title>Just a moment...</title><body style="background:#222"><h1>example.com</h1><p>Verifying you are human. This may take a few seconds.</p></body>`),
    );
    await expect(extractBrand({ url: `${check}/` })).rejects.toThrow(/showed a Cloudflare bot check/);
  });

  it("fails when the page redirects to a refused address", async (ctx) => {
    const inside = await listen("127.0.0.2", (_, res) => res.end("<h1>Inside</h1>")).catch(() => ctx.skip());
    const outside = await listen("127.0.0.1", (_, res) => res.writeHead(302, { location: `${inside}/` }).end());
    await expect(extractBrand({ url: `${outside}/`, allowAddress })).rejects.toThrow("The page tried to load from 127.0.0.2, an internal address");
  });

  it("fails when the page loads something from a refused address", async (ctx) => {
    const inside = await listen("127.0.0.2", (_, res) => res.writeHead(200, { "content-type": "text/css" }).end("body { color: red }")).catch(() => ctx.skip());
    const outside = await listen("127.0.0.1", (_, res) => res.writeHead(200, { "content-type": "text/html" }).end(`<link rel="stylesheet" href="${inside}/x.css"><h1>Outside</h1>`));
    await expect(extractBrand({ url: `${outside}/`, allowAddress })).rejects.toThrow("an internal address");
  });
});
