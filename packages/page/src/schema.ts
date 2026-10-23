import { z } from "zod";
import { FIELD_NAMES } from "@lph/forms";

/**
 * A landing page as data. Every block is one of the component library's sections, and a
 * person can only change copy and the few props the components expose (a tone, a card
 * style from the brand). Layout, spacing and colour come from the brand's tokens, so
 * there is nothing to drag around and nothing to break.
 */

export const TONES = ["default", "subtle", "brand"] as const;
export const CONNECTORS = ["none", "webhook", "hubspot"] as const;

/** Block ids double as anchors (#form) and as the first part of a variant's override paths. */
const blockId = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const tone = z.enum(TONES);
export const link = z.object({ label: z.string(), href: z.string() });
const item = z.object({ title: z.string(), body: z.string() });

const base = { id: blockId, tone };

export const heroBlock = z.object({
  ...base,
  type: z.literal("hero"),
  eyebrow: z.string(),
  /** The page's one H1. */
  heading: z.string(),
  lead: z.string(),
  primaryCta: link,
  /** An empty label hides it. */
  secondaryCta: link,
});
export const logosBlock = z.object({ ...base, type: z.literal("logos"), heading: z.string(), items: z.array(z.string()) });
export const featuresBlock = z.object({
  ...base,
  type: z.literal("features"),
  eyebrow: z.string(),
  heading: z.string(),
  intro: z.string(),
  items: z.array(item),
  /** One of the brand's card styles. */
  cardVariant: z.string(),
});
export const stepsBlock = z.object({ ...base, type: z.literal("steps"), heading: z.string(), intro: z.string(), items: z.array(item) });
export const statsBlock = z.object({ ...base, type: z.literal("stats"), heading: z.string(), items: z.array(z.object({ value: z.string(), label: z.string() })) });
export const testimonialBlock = z.object({ ...base, type: z.literal("testimonial"), quote: z.string(), name: z.string(), role: z.string(), company: z.string() });
export const comparisonBlock = z.object({
  ...base,
  type: z.literal("comparison"),
  heading: z.string(),
  intro: z.string(),
  columns: z.object({ ours: z.string(), theirs: z.string() }),
  rows: z.array(z.object({ label: z.string(), ours: z.string(), theirs: z.string() })),
});
export const faqBlock = z.object({ ...base, type: z.literal("faq"), heading: z.string(), items: z.array(z.object({ question: z.string(), answer: z.string() })) });
export const formBlock = z.object({
  ...base,
  type: z.literal("form"),
  heading: z.string(),
  intro: z.string(),
  fields: z.array(z.object({ name: z.enum(FIELD_NAMES), label: z.string(), required: z.boolean() })),
  submitLabel: z.string(),
  successMessage: z.string(),
  /** Shown under the button: what the details are used for. */
  consent: z.string(),
});
export const ctaBlock = z.object({ ...base, type: z.literal("cta"), heading: z.string(), body: z.string(), primaryCta: link, secondaryCta: link });

export const block = z.discriminatedUnion("type", [
  heroBlock,
  logosBlock,
  featuresBlock,
  stepsBlock,
  statsBlock,
  testimonialBlock,
  comparisonBlock,
  faqBlock,
  formBlock,
  ctaBlock,
]);

/**
 * A version of the page for one persona, on its own URL. It shares the general page's
 * structure and overrides copy only: keys are paths like "hero.heading" or
 * "features.items.0.title", plus "seo.title" and "seo.metaDescription".
 */
export const variant = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  personaId: z.string(),
  name: z.string(),
  slug: z.string(),
  overrides: z.record(z.string(), z.string()),
});

export const formSettings = z.object({
  connector: z.enum(CONNECTORS),
  webhookUrl: z.string(),
  hubspotPortalId: z.string(),
  hubspotFormId: z.string(),
});

/** The parts of a page a person may edit. Ids, the brand and brief it came from, and provenance stay as stored. */
export const pageEdit = z.object({
  title: z.string().max(200),
  slug: z.string().max(80),
  lang: z.string().max(20),
  seo: z.object({ title: z.string().max(300), metaDescription: z.string().max(600) }),
  blocks: z.array(block).max(30),
  variants: z.array(variant).max(10),
  form: formSettings,
});

export type Tone = (typeof TONES)[number];
export type Link = z.infer<typeof link>;
export type Block = z.infer<typeof block>;
export type BlockType = Block["type"];
export type BlockOf<T extends BlockType> = Extract<Block, { type: T }>;
export type HeroBlock = BlockOf<"hero">;
export type FormBlock = BlockOf<"form">;
export type Variant = z.infer<typeof variant>;
export type FormSettings = z.infer<typeof formSettings>;
export type PageEdit = z.infer<typeof pageEdit>;

export interface Page extends PageEdit {
  id: string;
  brandId: string;
  briefId: string;
  createdAt: string;
  updatedAt: string;
  generator: { name: string; model?: string };
  /** The last time the page was published as a pull request. */
  published?: { branch: string; commit: string; number: number; url: string; risk: "content" | "review"; at: string };
}

/** What a generator writes. toPage adds ids and provenance. */
export type PageDraft = Omit<PageEdit, "form"> & { form?: FormSettings };

export const BLOCK_NAMES: Record<BlockType, string> = {
  hero: "Hero",
  logos: "Logo row",
  features: "Features",
  steps: "How it works",
  stats: "Stats",
  testimonial: "Testimonial",
  comparison: "Comparison",
  faq: "FAQ",
  form: "Lead form",
  cta: "Closing CTA",
};
