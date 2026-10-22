import { BLOCK_NAMES, type Block, type Page, type PageEdit, type Variant } from "./schema.ts";

/**
 * Persona versions share the general page's blocks and override copy only. An override
 * key is "<block id>.<path>", e.g. "hero.heading" or "features.items.0.title", or
 * "seo.title" / "seo.metaDescription".
 */

// Structure and props stay shared by every version: only text can be personalised.
const SHARED = new Set(["id", "type", "tone", "cardVariant", "href", "required"]);
const isShared = (path: string[]) => SHARED.has(path.at(-1)!) || (path[0] === "fields" && path[2] === "name");

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

function getAt(value: unknown, path: string[]): unknown {
  let cur = value;
  for (const key of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function setAt(value: unknown, path: string[], next: string): boolean {
  const parent = getAt(value, path.slice(0, -1));
  const key = path.at(-1)!;
  if (parent === null || typeof parent !== "object" || typeof (parent as Record<string, unknown>)[key] !== "string") return false;
  (parent as Record<string, unknown>)[key] = next;
  return true;
}

const split = (key: string) => {
  const [head, ...rest] = key.split(".");
  return { head: head!, rest };
};

/** The general page's text at an override key, or undefined if the key points at nothing (or at a shared prop). */
export function baseValue(page: Pick<PageEdit, "blocks" | "seo">, key: string): string | undefined {
  const { head, rest } = split(key);
  if (!rest.length) return undefined;
  if (head === "seo") return rest.length === 1 && (rest[0] === "title" || rest[0] === "metaDescription") ? page.seo[rest[0]] : undefined;
  if (isShared(rest)) return undefined;
  const value = getAt(page.blocks.find((b) => b.id === head), rest);
  return typeof value === "string" ? value : undefined;
}

/** The text a version shows at a key: its override, or the general page's. */
export function valueIn(page: Pick<PageEdit, "blocks" | "seo">, variant: Variant | null | undefined, key: string): string | undefined {
  return variant?.overrides[key] ?? baseValue(page, key);
}

/** The page as one version shows it. Unknown variant ids give the general page. */
export function applyVariant<P extends Pick<PageEdit, "blocks" | "seo">>(page: P, variant: Variant | null | undefined): Pick<P, "blocks" | "seo"> {
  const out = { blocks: structuredClone(page.blocks), seo: { ...page.seo } };
  for (const [key, text] of Object.entries(variant?.overrides ?? {})) {
    const { head, rest } = split(key);
    if (head === "seo") {
      if (rest[0] === "title" || rest[0] === "metaDescription") out.seo[rest[0]] = text;
      continue;
    }
    if (isShared(rest)) continue;
    setAt(out.blocks.find((b) => b.id === head), rest, text);
  }
  return out as Pick<P, "blocks" | "seo">;
}

/** Drops overrides that no longer point at text (a removed block or item) or that match the general page. */
export function pruneOverrides<P extends Pick<PageEdit, "blocks" | "seo" | "variants">>(page: P): P {
  return {
    ...page,
    variants: page.variants.map((v) => ({
      ...v,
      overrides: Object.fromEntries(
        Object.entries(v.overrides).filter(([key, text]) => {
          const base = baseValue(page, key);
          return base !== undefined && base !== text;
        }),
      ),
    })),
  };
}

/** Every piece of text in a block, as override keys. The editor and the checks walk these. */
export function textPaths(block: Block): string[] {
  const out: string[] = [];
  const walk = (value: Json, path: string[]) => {
    if (typeof value === "string") {
      if (!isShared(path)) out.push([block.id, ...path].join("."));
    } else if (Array.isArray(value)) value.forEach((v, i) => walk(v, [...path, String(i)]));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, [...path, k]);
  };
  walk(block as unknown as Json, []);
  return out;
}

const FIELD_LABELS: Record<string, string> = {
  eyebrow: "Eyebrow",
  heading: "Heading",
  lead: "Subheadline",
  intro: "Intro",
  body: "Body",
  quote: "Quote",
  name: "Name",
  role: "Role",
  company: "Company",
  submitLabel: "Button",
  successMessage: "Thank-you message",
  consent: "Consent line",
  title: "Title",
  question: "Question",
  answer: "Answer",
  value: "Value",
  label: "Label",
  ours: "Ours",
  theirs: "Theirs",
};

/** A short name for an override key, for the versions table: "H1", "Subheadline", "Features item 2 title". */
export function keyLabel(page: Pick<PageEdit, "blocks">, key: string): string {
  const { head, rest } = split(key);
  if (head === "seo") return rest[0] === "title" ? "SEO title" : "Meta description";
  const block = page.blocks.find((b) => b.id === head);
  if (block?.type === "hero") {
    if (rest[0] === "heading") return "H1";
    if (rest[0] === "lead") return "Subheadline";
    if (rest[0] === "eyebrow") return "Eyebrow";
    if (rest[0] === "primaryCta") return "CTA";
    if (rest[0] === "secondaryCta") return "Secondary CTA";
  }
  const name = block ? BLOCK_NAMES[block.type] : head;
  const parts = rest.map((p, i) => (/^\d+$/.test(p) ? `${Number(p) + 1}` : i === 0 && /^(items|rows|fields)$/.test(p) ? p.replace(/s$/, "") : (FIELD_LABELS[p] ?? p).toLowerCase()));
  if (rest[0] === "primaryCta" || rest[0] === "secondaryCta") return `${name} ${rest[0] === "primaryCta" ? "button" : "secondary button"}`;
  return `${name} ${parts.join(" ")}`;
}

/** Where a version lives: the general page at /slug, each persona at /slug/persona. */
export const versionPath = (page: Pick<Page, "slug">, variant?: Pick<Variant, "slug"> | null) => (variant ? `/${page.slug}/${variant.slug}` : `/${page.slug}`);
