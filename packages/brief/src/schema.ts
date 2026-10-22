import { z } from "zod";

/**
 * The brief's shape. One zod schema serves three jobs: the structured output the
 * model must return, validation of edits coming through the API, and the TS types.
 * Structured outputs don't support min/max constraints, so limits that matter
 * (how many personas, title length) are enforced by the consistency check instead.
 */

export const FUNNEL_STAGES = ["awareness", "consideration", "decision", "retention"] as const;

/** Owned and earned channels only. Paid ads are out of scope for now. */
export const CHANNELS = [
  "organic-search",
  "answer-engines",
  "email",
  "organic-social",
  "partners",
  "events",
  "sales-outreach",
  "community",
  "in-product",
] as const;

/**
 * The page sections a brief can plan. Phase 3 builds pages from these, so the
 * outline can only use blocks the component library actually has.
 */
export const SECTIONS = {
  hero: "Opening section with the page's one H1, a short lead and the primary call to action.",
  logos: "A row of customer or partner logos for quick social proof.",
  features: "Three to six benefit cards, each a short heading and one or two sentences.",
  steps: "A numbered how-it-works sequence of three or four steps.",
  stats: "Two to four headline numbers, each with a label. Only real, sourced numbers.",
  testimonial: "One customer quote with name, role and company.",
  comparison: "A side-by-side table against the old way or a named alternative.",
  faq: "Questions and short answers. Also marked up as FAQPage for answer engines.",
  form: "A lead capture form that posts to the company's webhook (HubSpot first).",
  cta: "A closing band that repeats the primary call to action.",
} as const;
export type SectionType = keyof typeof SECTIONS;
const SECTION_TYPES = Object.keys(SECTIONS) as [SectionType, ...SectionType[]];

export const SEARCH_INTENTS = ["informational", "commercial", "transactional", "navigational"] as const;
export const SCHEMA_TYPES = ["FAQPage", "Product", "SoftwareApplication", "Service", "Organization", "HowTo", "Event", "Article"] as const;

/**
 * Where a claim comes from: the site's pages, the marketer's request, or the site's own
 * data (its MCP server). "needed" means nobody has evidence yet, so it can't ship as is.
 */
export const PROOF_SOURCES = ["site", "data", "prompt", "needed"] as const;

export const persona = z.object({
  name: z.string().describe("A short label for the segment, e.g. 'Ops lead at a 50-person agency'."),
  role: z.string().describe("Job title or buying role."),
  context: z.string().describe("One or two sentences on their situation when they land on this page."),
  pains: z.array(z.string()),
  motivations: z.array(z.string()),
  objections: z.array(z.string()),
});

export const proofPoint = z.object({
  claim: z.string(),
  source: z.enum(PROOF_SOURCES),
  evidence: z.string().describe("The exact text from the site copy, site data or prompt that backs the claim, or, when source is 'needed', what evidence would."),
});

export const outlineSection = z.object({
  type: z.enum(SECTION_TYPES),
  heading: z.string().describe("Working heading for the section, in the brand's casing style."),
  purpose: z.string().describe("What this section has to achieve for the reader."),
  notes: z.string().describe("Content notes for the writer: which messages, proof or questions go here."),
});

export const seoTargets = z.object({
  primaryKeyword: z.string(),
  secondaryKeywords: z.array(z.string()),
  searchIntent: z.enum(SEARCH_INTENTS),
  title: z.string().describe("The <title>, ideally 30 to 60 characters, containing the primary keyword."),
  metaDescription: z.string().describe("120 to 160 characters, containing the primary keyword and the offer."),
  slug: z.string().describe("Lowercase words separated by hyphens, no leading slash."),
  questions: z
    .array(z.object({ question: z.string(), answer: z.string() }))
    .describe("Questions people ask answer engines about this topic, each with a direct 40 to 60 word answer."),
  schemaTypes: z.array(z.enum(SCHEMA_TYPES)),
});

export const briefContent = z.object({
  title: z.string().describe("Internal name for the campaign page."),
  summary: z.string().describe("Two or three sentences a stakeholder can read on their own."),
  objective: z.object({
    statement: z.string(),
    kpi: z.object({
      metric: z.string().describe("What is counted, e.g. 'demo requests from the page'."),
      target: z.string().describe("The goal, e.g. '40 per month'. Use 'Set a target' if the prompt gives no basis for one."),
      timeframe: z.string(),
    }),
  }),
  personas: z.array(persona),
  funnelStage: z.enum(FUNNEL_STAGES),
  channels: z.array(z.object({ channel: z.enum(CHANNELS), role: z.string() })),
  keyMessages: z.array(z.object({ message: z.string(), support: z.string() })),
  offer: z.object({
    offer: z.string().describe("What the visitor gets."),
    primaryCta: z.string().describe("Button label, two to four words."),
    secondaryCta: z.string().describe("Optional lower-commitment action. Empty string if none."),
  }),
  proofPoints: z.array(proofPoint),
  outline: z.array(outlineSection),
  seo: seoTargets,
  assumptions: z.array(z.string()).describe("Anything assumed that the marketer should confirm."),
});

export type Persona = z.infer<typeof persona> & { id: string };
export type ProofPoint = z.infer<typeof proofPoint>;
export type OutlineSection = z.infer<typeof outlineSection>;
export type SeoTargets = z.infer<typeof seoTargets>;
export type BriefContent = z.infer<typeof briefContent>;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];
export type Channel = (typeof CHANNELS)[number];

/** Keyword data from whichever SEO/AEO tool is connected. Volumes are null when the tool has none. */
export interface SeoInsights {
  provider: string;
  keywords: { term: string; volume: number | null; difficulty: number | null; intent: string | null }[];
  questions: string[];
  notes: string[];
}

/** One answer from the site's MCP server: a read-only tool's output or a resource. */
export interface SiteFact {
  /** "tool:<name>" or "resource:<uri>". */
  source: string;
  label: string;
  text: string;
}

/** What the site's own data said about the topic, collected before the brief is written. */
export interface SiteData {
  server: { name: string; url: string } | null;
  facts: SiteFact[];
  notes: string[];
}

export interface Brief extends Omit<BriefContent, "personas"> {
  id: string;
  brandId: string;
  prompt: string;
  personas: Persona[];
  createdAt: string;
  updatedAt: string;
  generator: { name: string; model?: string };
  insights: SeoInsights;
  /** Absent on briefs written without a connected MCP server. */
  siteData?: SiteData;
}

/** The parts of a brief a person may edit. Ids, prompt and provenance stay as stored. */
export const briefEdit = briefContent.extend({
  personas: z.array(persona.extend({ id: z.string().regex(/^[a-z0-9-]+$/) })),
});
export type BriefEdit = z.infer<typeof briefEdit>;
