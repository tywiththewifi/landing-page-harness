import type { Brand } from "@lph/tokens";
import { slugify } from "./ground.ts";
import type { Brief, BriefContent, SeoInsights, SiteData } from "./schema.ts";

export interface BriefInput {
  prompt: string;
  brand: Brand;
  insights: SeoInsights;
  /** Answers from the site's MCP server, when one is connected. */
  siteData?: SiteData;
}

export interface BriefGenerator {
  name: string;
  model?: string;
  generate(input: BriefInput): Promise<BriefContent>;
}

/** Thrown when the model declines or its answer doesn't fit the schema. */
export class GenerationError extends Error {}

const uniqueSlug = (base: string, taken: Set<string>) => {
  let id = base || "persona";
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  taken.add(id);
  return id;
};

/** Turns generated content into a stored brief: ids for personas (each becomes a page variant), a clean slug. */
export function toBrief(
  content: BriefContent,
  meta: { id: string; brandId: string; prompt: string; generator: BriefGenerator; insights: SeoInsights; siteData?: SiteData; now?: Date },
): Brief {
  const now = (meta.now ?? new Date()).toISOString();
  const taken = new Set<string>();
  return {
    ...content,
    id: meta.id,
    brandId: meta.brandId,
    prompt: meta.prompt,
    personas: content.personas.map((p) => ({ ...p, id: uniqueSlug(slugify(p.name), taken) })),
    seo: { ...content.seo, slug: slugify(content.seo.slug) || slugify(content.seo.primaryKeyword) },
    createdAt: now,
    updatedAt: now,
    generator: { name: meta.generator.name, ...(meta.generator.model ? { model: meta.generator.model } : {}) },
    insights: meta.insights,
    ...(meta.siteData ? { siteData: meta.siteData } : {}),
  };
}
