import { PLACEHOLDER, casingOf, dataText, numberIsSourced, numbersIn, siteCasing, siteText, textIsSourced, type Brief } from "@lph/brief/browser";
import type { Brand } from "@lph/tokens";
import { buttonsFor } from "./brand.ts";
import { SAFE_HREF } from "./blocks.ts";
import { BLOCK_NAMES, type Block, type Page, type Variant } from "./schema.ts";
import { applyVariant, baseValue, keyLabel, textPaths, versionPath } from "./variants.ts";

export interface PageIssue {
  id: string;
  /** error: blocks publishing. warning: needs a reviewer's eye. info: worth a look. */
  severity: "error" | "warning" | "info";
  /** A block id, or "page", "seo", "leads" (where the form sends leads) or "versions". The editor jumps there. */
  area: string;
  /** The version the issue is in. Absent for the general page. */
  variant?: string;
  /** The text the issue is about, as an override key ("hero.heading"), so the editor can point at the field. */
  path?: string;
  message: string;
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const QUOTE_MARKS = /^["“”']+|["“”']+$/g;

/** Text a block must have, as paths inside it. "*" stands for every item. */
const REQUIRED: Partial<Record<Block["type"], string[]>> = {
  hero: ["heading", "primaryCta.label"],
  features: ["items.*.title"],
  steps: ["items.*.title"],
  stats: ["items.*.value", "items.*.label"],
  testimonial: ["quote", "name"],
  comparison: ["rows.*.label"],
  faq: ["items.*.question", "items.*.answer"],
  form: ["submitLabel"],
  cta: ["heading", "primaryCta.label"],
};

function expand(block: Block, pattern: string): string[] {
  const [list, , ...rest] = pattern.split(".");
  if (!pattern.includes("*")) return [`${block.id}.${pattern}`];
  const items = (block as unknown as Record<string, unknown[]>)[list!] ?? [];
  return items.map((_, i) => [block.id, list, i, ...rest].join("."));
}

/**
 * Checks a page the way a reviewer would before it goes live: structure, unfinished or
 * unsourced copy, links that go nowhere, the form and where its leads go, search and
 * answer-engine basics, and each persona version. Runs in the editor as you type and
 * again in the publish gate.
 */
export function checkPage(page: Page, brief: Brief, brand: Brand): PageIssue[] {
  const issues: PageIssue[] = [];
  const add = (severity: PageIssue["severity"], area: string, id: string, message: string, extra: Partial<PageIssue> = {}) =>
    issues.push({ id: `${extra.variant ? `${extra.variant}:` : ""}${area}.${id}`, severity, area, message, ...extra });
  const name = (b: Block) => BLOCK_NAMES[b.type];
  const { blocks } = page;
  const ids = new Set(blocks.map((b) => b.id));

  // Structure: one hero first, so the page has one H1 and it's the first thing read.
  if (!blocks.length) add("error", "page", "empty", "The page has no sections.");
  else if (blocks[0]!.type !== "hero") add("error", blocks[0]!.id, "hero-first", "The page has to open with the hero: it holds the H1.");
  if (blocks.filter((b) => b.type === "hero").length > 1) add("error", "page", "one-hero", "Use one hero. A page has one H1.");

  // Grounding: numbers and quotes must come from the site, its data, the request or the brief's sourced proof.
  const sources = [
    ...siteText(brand),
    ...dataText(brief.siteData),
    brief.prompt,
    ...brief.proofPoints.filter((p) => p.source !== "needed").map((p) => p.evidence),
  ];

  /** Copy checks for one version. The general page checks everything; a version only what it overrides. */
  const checkCopy = (view: Pick<Page, "blocks" | "seo">, variant: Variant | null) => {
    const v = variant ? { variant: variant.id } : {};
    const who = variant ? `${variant.name}: ` : "";
    const keys = variant ? Object.keys(variant.overrides) : [...view.blocks.flatMap(textPaths), "seo.title", "seo.metaDescription"];
    const text = (key: string) => baseValue(view, key) ?? "";
    // A version is only checked on what it changes, so it doesn't repeat the general page's issues.
    const touched = (key: string) => !variant || key in variant.overrides;
    const area = (key: string) => (key.startsWith("seo.") ? "seo" : key.split(".")[0]!);

    const unwritten = new Map<string, string[]>();
    const flagged = new Set<string>();
    for (const key of keys) {
      const value = text(key);
      if (value.includes(PLACEHOLDER)) unwritten.set(area(key), [...(unwritten.get(area(key)) ?? []), key]);
      else
        for (const n of numbersIn(value)) {
          if (flagged.has(n) || numberIsSourced(n, sources)) continue;
          flagged.add(n);
          add("warning", area(key), `number-${flagged.size}`, `${who}"${n}" isn't on your site, in its data or in the request. Add the source to the brief's proof points or remove it.`, { ...v, path: key });
        }
    }
    for (const [where, list] of unwritten) {
      const block = view.blocks.find((b) => b.id === where);
      const label = where === "seo" ? "SEO" : block ? name(block) : where;
      const what = list.length === 1 ? `${keyLabel(view, list[0]!)} still needs` : `${label}: ${list.length} fields still need`;
      add("error", where, "placeholders", `${who}${what} writing (marked ${PLACEHOLDER}).`, { ...v, path: list[0] });
    }

    for (const b of view.blocks) {
      if (b.type === "hero") {
        if (touched(`${b.id}.heading`) && b.heading.length > 70) add("warning", b.id, "h1-length", `${who}The H1 is ${b.heading.length} characters. Under 70 reads at a glance.`, { ...v, path: `${b.id}.heading` });
        if (touched(`${b.id}.lead`) && b.lead.length > 220) add("info", b.id, "lead-length", `${who}The subheadline is ${b.lead.length} characters. One or two short sentences work best.`, { ...v, path: `${b.id}.lead` });
      }
      if (b.type === "hero" || b.type === "cta") {
        for (const [slot, link] of [["primaryCta", b.primaryCta], ["secondaryCta", b.secondaryCta]] as const) {
          if (touched(`${b.id}.${slot}.label`) && words(link.label) > 5) add("warning", b.id, `${slot}-length`, `${who}"${link.label}" is long for a button. Aim for two to four words.`, { ...v, path: `${b.id}.${slot}.label` });
        }
      }
      if (b.type === "testimonial" && touched(`${b.id}.quote`) && !b.quote.includes(PLACEHOLDER) && b.quote.trim() && !textIsSourced(b.quote.replace(QUOTE_MARKS, ""), sources)) {
        add("warning", b.id, "quote-source", `${who}This quote isn't on your site or in the brief's proof. Publish it only if it's real and you have the customer's permission.`, { ...v, path: `${b.id}.quote` });
      }
      if (b.type === "faq") {
        const short = b.items.filter((q, i) => touched(`${b.id}.items.${i}.answer`) && q.answer.trim() && !q.answer.includes(PLACEHOLDER) && words(q.answer) < 25).length;
        if (short) add("info", b.id, "answers", `${who}${short} FAQ answer${short === 1 ? " is" : "s are"} under 25 words. Answer engines quote complete 40 to 60 word answers.`, v);
      }
    }
  };

  checkCopy(page, null);
  for (const v of page.variants) checkCopy(applyVariant(page, v), v);

  // Text every block needs, and links that go somewhere.
  for (const b of blocks) {
    for (const key of (REQUIRED[b.type] ?? []).flatMap((p) => expand(b, p))) {
      if (!(baseValue(page, key) ?? "").trim()) add("error", b.id, `empty-${key}`, `${name(b)}: ${keyLabel(page, key)} is empty.`, { path: key });
    }
    if (b.type === "hero" || b.type === "cta") {
      for (const [slot, link] of [["primaryCta", b.primaryCta], ["secondaryCta", b.secondaryCta]] as const) {
        if (!link.label.trim()) continue;
        const href = link.href.trim();
        const path = `${b.id}.${slot}.label`;
        if (!href || href === "#") add("error", b.id, `${slot}-href`, `Set where "${link.label}" goes.`, { path });
        else if (!SAFE_HREF.test(href)) add("error", b.id, `${slot}-href`, `"${href}" isn't a link the page can use. Use a section (#form), a path (/pricing) or an https address.`, { path });
        else if (href.startsWith("#") && !ids.has(href.slice(1))) add("error", b.id, `${slot}-href`, `"${link.label}" points at ${href}, but there's no section with that id.`, { path });
        else if (href.startsWith("http://")) add("warning", b.id, `${slot}-href`, `"${link.label}" links over http. Use https.`, { path });
      }
    }
    if (b.type === "features" && brand.cards.length && !brand.cards.some((c) => c.name === b.cardVariant)) {
      add("warning", b.id, "card", `"${b.cardVariant}" isn't one of ${brand.name}'s card styles (${brand.cards.map((c) => c.name).join(", ")}).`);
    }
    if (b.type === "features" && (b.items.length < 2 || b.items.length > 6)) add("info", b.id, "items", `${b.items.length} features. Three to six reads best.`);
    if (b.type === "stats" && b.items.length > 4) add("info", b.id, "items", "More than four stats dilutes them. Keep the strongest.");
  }
  // Buttons are picked per band; say so when none of the brand's would stand out on one.
  for (const b of blocks) {
    if ((b.type === "hero" || b.type === "cta") && !buttonsFor(brand, b.type === "hero" ? "hero" : b.tone).visible) {
      add("warning", b.id, "buttons", `None of ${brand.name}'s button styles stands out on this ${b.type === "hero" ? "hero" : `${b.tone} band`}. Change the band's tone, or add a button style to the brand.`);
    }
  }

  // The form and where its leads go.
  const forms = blocks.filter((b) => b.type === "form");
  for (const f of forms) {
    if (!f.fields.some((x) => x.name === "email" || x.name === "phone")) add("error", f.id, "contact", "The form needs an email or phone field, or there's no way to reply.");
    const names = f.fields.map((x) => x.name);
    if (new Set(names).size !== names.length) add("error", f.id, "duplicate", "The form asks for the same field twice.");
    if (f.fields.length > 6) add("info", f.id, "length", `${f.fields.length} fields. Every extra field costs submissions: ask only what sales needs.`);
    if (f.fields.some((x) => !x.label.trim())) add("error", f.id, "label", "Every form field needs a label.");
  }
  const { form } = page;
  if (forms.length) {
    if (form.connector === "none") add("warning", "leads", "connector", "Leads aren't sent anywhere yet. Connect HubSpot or a webhook.");
    if (form.connector === "hubspot") {
      if (!/^\d+$/.test(form.hubspotPortalId.trim())) add("error", "leads", "hubspot-portal", "Add your HubSpot portal ID (a number, shown in HubSpot's account menu).");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(form.hubspotFormId.trim())) add("error", "leads", "hubspot-form", "Add the HubSpot form's ID (the GUID in the form editor's URL).");
    }
    if (form.connector === "webhook" && !/^https:\/\/\S+$/.test(form.webhookUrl.trim())) add("error", "leads", "webhook", "The webhook needs an https URL.");
  } else if (form.connector !== "none") add("info", "leads", "unused", "A form connector is set up, but the page has no form block.");

  // Search and answer engines.
  const kw = brief.seo.primaryKeyword.trim().toLowerCase();
  const seoFor = (seo: Page["seo"], variant?: Variant) => {
    const v = variant ? { variant: variant.id } : {};
    const who = variant ? `${variant.name}: ` : "";
    if (seo.title.length < 30 || seo.title.length > 60) add("warning", "seo", "title-length", `${who}The title is ${seo.title.length} characters. Search results show about 30 to 60.`, { ...v, path: "seo.title" });
    if (seo.metaDescription.length < 120 || seo.metaDescription.length > 160) add("warning", "seo", "meta-length", `${who}The meta description is ${seo.metaDescription.length} characters. Aim for 120 to 160.`, { ...v, path: "seo.metaDescription" });
    if (!variant && kw && !seo.title.toLowerCase().includes(kw)) add("warning", "seo", "keyword-title", `The title doesn't contain "${brief.seo.primaryKeyword}".`, { path: "seo.title" });
  };
  seoFor(page.seo);
  for (const v of page.variants) if (v.overrides["seo.title"] !== undefined || v.overrides["seo.metaDescription"] !== undefined) seoFor(applyVariant(page, v).seo, v);
  if (!SLUG.test(page.slug)) add("error", "seo", "slug", `"/${page.slug}" isn't a clean URL. Use lowercase words separated by hyphens.`);
  const hero = blocks.find((b) => b.type === "hero");
  if (kw && hero?.type === "hero" && !hero.heading.toLowerCase().includes(kw)) add("info", "seo", "keyword-h1", `The H1 doesn't contain "${brief.seo.primaryKeyword}".`, { path: `${hero.id}.heading` });
  if (brief.seo.schemaTypes.includes("FAQPage") && !blocks.some((b) => b.type === "faq")) add("warning", "seo", "faq", "The brief plans FAQPage markup, but the page has no FAQ section.");

  // Persona versions: each on its own URL, each actually different.
  const slugs = new Set<string>();
  for (const v of page.variants) {
    const at = { variant: v.id };
    if (!SLUG.test(v.slug)) add("error", "versions", "slug", `${v.name}: "${v.slug}" isn't a clean URL part. Use lowercase words separated by hyphens.`, at);
    else if (slugs.has(v.slug)) add("error", "versions", "slug-taken", `${v.name}: ${versionPath(page, v)} is already used by another version.`, at);
    slugs.add(v.slug);
    if (!Object.keys(v.overrides).length) add("warning", "versions", "same", `${v.name} is the same as the general page. Personalise its hero or remove it.`, at);
  }
  for (const p of brief.personas) {
    if (!page.variants.some((v) => v.personaId === p.id)) add("info", "versions", `persona-${p.id}`, `${p.name} has no version of the page yet.`);
  }

  // The new page should read like the rest of the site.
  const casing = siteCasing(brand);
  if (casing) {
    const off = blocks
      .flatMap((b) => ("heading" in b && b.heading && !b.heading.includes(PLACEHOLDER) ? [b.heading] : []))
      .filter((h) => casingOf(h) && casingOf(h) !== casing);
    if (off.length) add("info", "page", "casing", `${brand.name} writes headings in ${casing === "title" ? "Title Case" : "sentence case"}. Check: ${off.map((h) => `"${h}"`).join(", ")}.`);
  }

  return issues;
}
