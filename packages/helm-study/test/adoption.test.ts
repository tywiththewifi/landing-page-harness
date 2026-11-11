import { describe, expect, it } from "vitest";
import { classifyHtml } from "../src/adoption.ts";

const repeat = (s: string, n: number) => Array.from({ length: n }, () => s).join("");

describe("classifyHtml", () => {
  it("calls a page with hds- classes a Helm page and lists its components", () => {
    const html = repeat('<a class="hds-button hds-button--primary">Go<svg class="hds-icon hds-icon-hover-arrow"></svg></a>', 12) + '<p class="hds-text hds-color-text-solid">x</p>';
    const page = classifyHtml("/", html);
    expect(page.system).toBe("helm");
    expect(page.helmShare).toBe(1);
    expect(page.helmComponents).toEqual(["hds-button", "hds-icon", "hds-icon-hover-arrow", "hds-text"]);
    expect(page.roles["Button"]).toEqual({ legacy: 0, helm: 12 });
  });

  it("calls a page of PascalCase blocks a legacy page and counts what's left to move", () => {
    const html = repeat('<a class="CtaButton variant--Button">Go<svg class="HoverArrow"></svg></a>', 15);
    const page = classifyHtml("/payments", html);
    expect(page.system).toBe("legacy");
    expect(page.roles["Button"]).toEqual({ legacy: 15, helm: 0 });
    expect(page.roles["Hover arrow"]).toEqual({ legacy: 15, helm: 0 });
  });

  it("calls a page with both a mixed page, and one with too little markup unknown", () => {
    expect(classifyHtml("/m", repeat('<i class="hds-text"></i>', 15) + repeat('<i class="Copy__body"></i>', 15)).system).toBe("mixed");
    expect(classifyHtml("/u", '<i class="hds-text"></i>').system).toBe("unknown");
  });

  it("doesn't count lowercase or utility classes as the older system", () => {
    const page = classifyHtml("/", repeat('<div class="hero-section section-row"></div>', 30));
    expect(page.legacyElements).toBe(0);
  });
});
