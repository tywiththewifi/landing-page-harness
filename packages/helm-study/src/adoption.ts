/**
 * Which stripe.com pages are built on Helm, and which still run the older system.
 *
 * Helm's classes carry an `hds-` prefix (hds-button, hds-heading). The older system
 * names blocks in PascalCase BEM (CtaButton, HoverArrow, RefreshedNavigation). Counting
 * both in the HTML a page serves shows how far a migration has got, page by page, and
 * which old components still need a Helm equivalent.
 */
import { chromium } from "playwright";

export type System = "helm" | "legacy" | "mixed" | "unknown";

/** Older component → the Helm component that replaces it, matched by role on pages built with each. */
export const EQUIVALENTS: { role: string; legacy: RegExp; helm: RegExp }[] = [
  { role: "Button", legacy: /^CtaButton$/, helm: /^hds-button$/ },
  { role: "Hover arrow", legacy: /^HoverArrow$/, helm: /^hds-icon-hover-arrow$/ },
  { role: "Navigation", legacy: /^(SiteHeader|RefreshedNavigation)$/, helm: /^hds-navigation-menu$/ },
  { role: "Text", legacy: /^Copy$/, helm: /^hds-(text|heading)$/ },
  { role: "Link", legacy: /^Link$/, helm: /^hds-link$/ },
];

export interface PageAdoption {
  path: string;
  /** Elements with at least one hds- class. */
  helmElements: number;
  /** Elements with at least one PascalCase block class. */
  legacyElements: number;
  /** helm / (helm + legacy), 0..1. */
  helmShare: number;
  system: System;
  /** The Helm component classes on the page (blocks only, no modifiers). */
  helmComponents: string[];
  /** For each role, how many elements use the old and the Helm version. */
  roles: Record<string, { legacy: number; helm: number }>;
}

const CLASS_ATTR = /\sclass="([^"]*)"/g;
const LEGACY_BLOCK = /^([A-Z][A-Za-z0-9]+)(?:__|--|$)/;

export function classifyHtml(path: string, html: string): PageAdoption {
  let helm = 0;
  let legacy = 0;
  const components = new Set<string>();
  const roles: PageAdoption["roles"] = Object.fromEntries(EQUIVALENTS.map((e) => [e.role, { legacy: 0, helm: 0 }]));

  for (const m of html.matchAll(CLASS_ATTR)) {
    const classes = m[1]!.split(/\s+/).filter(Boolean);
    const blocks = new Set<string>();
    let isHelm = false;
    let isLegacy = false;
    for (const c of classes) {
      if (c.startsWith("hds-")) {
        isHelm = true;
        const block = c.split(/__|--/)[0]!;
        blocks.add(block);
        // Utility classes (colour, spacing, mode) aren't components.
        if (!/^hds-(color|space|mode|nowrap)/.test(block)) components.add(block);
      } else {
        const legacyBlock = LEGACY_BLOCK.exec(c)?.[1];
        if (legacyBlock) {
          isLegacy = true;
          blocks.add(legacyBlock);
        }
      }
    }
    if (isHelm) helm++;
    if (isLegacy) legacy++;
    for (const e of EQUIVALENTS) {
      if ([...blocks].some((b) => e.legacy.test(b))) roles[e.role]!.legacy++;
      if ([...blocks].some((b) => e.helm.test(b))) roles[e.role]!.helm++;
    }
  }

  const total = helm + legacy;
  const helmShare = total ? helm / total : 0;
  const system: System = total < 20 ? "unknown" : helmShare > 0.8 ? "helm" : helmShare < 0.05 ? "legacy" : "mixed";
  return { path, helmElements: helm, legacyElements: legacy, helmShare: Math.round(helmShare * 1000) / 1000, system, helmComponents: [...components].sort(), roles };
}

/** Main marketing pages: products, the pricing and enterprise pages, and company pages. */
export const PAGES = [
  "/",
  "/payments",
  "/billing",
  "/connect",
  "/radar",
  "/terminal",
  "/tax",
  "/atlas",
  "/climate",
  "/issuing",
  "/treasury",
  "/capital",
  "/identity",
  "/invoicing",
  "/payments/checkout",
  "/payments/elements",
  "/payments/link",
  "/pricing",
  "/enterprise",
  "/startups",
  "/customers",
  "/about",
  "/guides",
  "/newsroom",
  "/contact/sales",
];

/**
 * Reads each page as a browser renders it: some of the older components (CtaButton) are
 * only added to the page by script, so the served HTML undercounts them.
 */
export async function auditSite(origin: string, pages = PAGES, onPage: (path: string) => void = () => {}): Promise<PageAdoption[]> {
  const browser = await launch();
  const out: PageAdoption[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
    const page = await context.newPage();
    // One page at a time, with a pause: this is a study, not a crawl.
    for (const path of pages) {
      onPage(path);
      const res = await page.goto(origin + path, { waitUntil: "networkidle", timeout: 60000 }).catch(() => null);
      if (!res?.ok()) continue;
      out.push(classifyHtml(path, await page.content()));
      await page.waitForTimeout(500);
    }
  } finally {
    await browser.close();
  }
  return out;
}

export function launch() {
  return chromium.launch({ headless: true, executablePath: process.env.LPH_CHROMIUM_PATH || undefined });
}
