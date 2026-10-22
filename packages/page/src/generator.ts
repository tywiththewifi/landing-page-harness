import type { Brief } from "@lph/brief/browser";
import { slugify } from "@lph/brief/browser";
import type { Brand } from "@lph/tokens";
import { nextBlockId } from "./blocks.ts";
import type { FormSettings, Page, PageDraft } from "./schema.ts";
import { pruneOverrides } from "./variants.ts";

export interface PageInput {
  brief: Brief;
  brand: Brand;
}

export interface PageGenerator {
  name: string;
  model?: string;
  generate(input: PageInput): Promise<PageDraft>;
}

export const NO_FORM: FormSettings = { connector: "none", webhookUrl: "", hubspotPortalId: "", hubspotFormId: "" };

/**
 * Turns a draft into a stored page: unique block ids, clean slugs for the page and each
 * version, and no overrides that just repeat the general page.
 */
export function toPage(draft: PageDraft, meta: { id: string; brief: Brief; generator: PageGenerator; now?: Date }): Page {
  const now = (meta.now ?? new Date()).toISOString();
  const ids: string[] = [];
  const blocks = draft.blocks.map((b) => {
    const id = ids.includes(b.id) || !b.id ? nextBlockId(b.type, ids) : b.id;
    ids.push(id);
    return { ...b, id };
  });
  const slugs: string[] = [];
  const variants = draft.variants.map((v) => {
    const base = slugify(v.slug) || slugify(v.name) || "version";
    let slug = base;
    for (let i = 2; slugs.includes(slug); i++) slug = `${base}-${i}`;
    slugs.push(slug);
    return { ...v, slug };
  });
  return pruneOverrides({
    ...draft,
    id: meta.id,
    brandId: meta.brief.brandId,
    briefId: meta.brief.id,
    slug: slugify(draft.slug) || meta.brief.seo.slug,
    blocks,
    variants,
    form: draft.form ?? NO_FORM,
    createdAt: now,
    updatedAt: now,
    generator: { name: meta.generator.name, ...(meta.generator.model ? { model: meta.generator.model } : {}) },
  });
}
