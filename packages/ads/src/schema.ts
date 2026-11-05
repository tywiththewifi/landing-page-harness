import { z } from "zod";

/**
 * What the marketer asks for: the goal of the ads, how long they run, and anything
 * the ads must not say. The landing page and its versions come from phase 3.
 */
export const adBrief = z.object({
  /** One line, in the marketer's words. Numbers in it count as a source, like the site's copy. */
  prompt: z.string(),
  /** Spoken length, in seconds. Ads are read, so length is estimated from word count before voicing and measured after. */
  seconds: z.object({ min: z.number().positive(), max: z.number().positive() }),
  /** Words a voice reads per second, used to estimate length before anything is voiced. */
  wordsPerSecond: z.number().positive().default(2.5),
  /** Words or names the ads must not say, such as competitors. */
  avoid: z.array(z.string()).default([]),
});
export type AdBrief = z.infer<typeof adBrief>;
export type AdBriefInput = z.input<typeof adBrief>;

/** One ad, as the writer returns it. */
export const adConcept = z.object({
  /** Short id, lowercase words joined by hyphens. */
  id: z.string(),
  /** The idea in a few words, for the people reviewing it. */
  angle: z.string(),
  /** Which version of the landing page the ad sends people to: its slug, or null for the general page. */
  version: z.string().nullable(),
  /** Shown next to the ad where there's a screen, and used to check the ad matches its landing page. */
  headline: z.string(),
  /** Exactly what the voice reads. */
  script: z.string(),
  /** The call to action, word for word as the script says it. */
  cta: z.string(),
});
export type AdConcept = z.infer<typeof adConcept>;

export const conceptSet = z.object({ concepts: z.array(adConcept) });

/** Concepts saved by a run, with who wrote them, so a re-run reports the same provenance. */
export const savedConcepts = conceptSet.extend({ writer: z.object({ name: z.string(), model: z.string().optional() }).optional() });

export type Severity = "error" | "warning" | "info";

/** A finding from the gate or the audio check. Errors block the ad. */
export interface AdIssue {
  /** Stable rule id, e.g. "number.unsourced". The evals check for these. */
  rule: string;
  severity: Severity;
  message: string;
}
