import { PLACEHOLDER, numbersIn, type Brief, type Persona } from "@lph/brief/browser";
import type { Brand } from "@lph/tokens";
import { emptyBlock, formField, nextBlockId, written } from "./blocks.ts";
import type { PageGenerator } from "./generator.ts";
import type { Block, BlockType, Link, PageDraft, Tone, Variant } from "./schema.ts";

const todo = (what: string) => `${PLACEHOLDER} ${what}`;
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "Ops leads" becomes "ops leads" after "For"; "RevOps leads" and "VP Sales" keep their capitals. */
const lowerFirst = (s: string) => (/^\p{Lu}\p{Ll}+(\s|$)/u.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const words = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3));

/** The first quoted sentence in a piece of evidence: a testimonial needs someone's actual words. */
const QUOTE = /["“]([^"”]{20,})["”]/;

/** Where the hero's buttons point: the form when there is one, otherwise a section that explains more. */
function ctas(brief: Brief, types: BlockType[]): { primary: Link; secondary: Link } {
  const primary = { label: brief.offer.primaryCta || todo("Button"), href: types.includes("form") ? "#form" : "#" };
  const more = types.find((t) => t === "steps" || t === "features");
  const secondary = brief.offer.secondaryCta.trim() ? { label: brief.offer.secondaryCta, href: more ? `#${more}` : "#" } : { label: "", href: "" };
  return { primary, secondary };
}

/** One block of copy from the brief: its messages, sourced proof and questions. Gaps stay marked for a person. */
function blockFor(type: BlockType, heading: string, id: string, brief: Brief, brand: Brand, cta: { primary: Link; secondary: Link }): Block {
  const proof = brief.proofPoints.filter((p) => p.source !== "needed");
  const offer = written(brief.offer.offer) ? brief.offer.offer : null;
  const blank = emptyBlock(type, id, { cardVariant: brand.cards[0]?.name, cta: brief.offer.primaryCta || undefined, customers: brand.customers?.map((c) => c.name) });
  const head = heading.trim() ? heading : todo("Heading");

  switch (blank.type) {
    case "hero": {
      const support = brief.keyMessages.map((m) => m.support).find(written);
      return { ...blank, heading: heading || todo("Headline"), lead: offer ?? support ?? todo("One or two sentences on what the reader gets."), primaryCta: cta.primary, secondaryCta: cta.secondary };
    }
    case "features": {
      const items = brief.keyMessages.slice(0, 6).map((m) => ({ title: m.message, body: m.support }));
      while (items.length < 3) items.push({ title: todo(`Benefit ${items.length + 1}`), body: PLACEHOLDER });
      return { ...blank, heading: head, items };
    }
    case "stats": {
      const items = proof.flatMap((p) => {
        const n = numbersIn(p.claim)[0];
        if (!n) return [];
        const label = p.claim.replace(n, "").replace(/\s+/g, " ").replace(/^[\s,.:–-]+|[\s,.:–-]+$/g, "");
        return [{ value: n, label: sentence(label) }];
      });
      while (items.length < 2) items.push({ value: PLACEHOLDER, label: todo("What it measures") });
      return { ...blank, heading: written(heading) ? heading : "", items: items.slice(0, 4) };
    }
    case "testimonial": {
      const quote = proof.map((p) => QUOTE.exec(p.evidence)?.[1]).find(Boolean);
      return quote ? { ...blank, quote } : blank;
    }
    case "comparison":
      return { ...blank, heading: head, columns: { ours: brand.name, theirs: "The old way" } };
    case "faq":
      return { ...blank, heading: written(heading) ? heading : blank.heading, items: brief.seo.questions.length ? brief.seo.questions.map((q) => ({ ...q })) : blank.items };
    case "form": {
      const fields = [formField("email", true), formField("firstname", true), formField("lastname"), formField("company")];
      if (brief.funnelStage === "decision") fields.push(formField("jobtitle"));
      return { ...blank, heading: written(heading) ? heading : brief.offer.primaryCta || blank.heading, intro: offer ?? "", fields };
    }
    case "cta":
      return { ...blank, heading: head, body: offer ?? "", primaryCta: cta.primary, secondaryCta: cta.secondary };
    default:
      return { ...blank, heading: head } as Block;
  }
}

/**
 * A version for one persona: the eyebrow names who it's for, and the hero leads with the
 * key message closest to what they care about. Nothing is invented: every line comes
 * from the brief.
 */
function variantFor(persona: Persona, brief: Brief, hero: Extract<Block, { type: "hero" }> | undefined): Variant {
  const overrides: Record<string, string> = {};
  if (hero) {
    const who = [persona.role, persona.name].find(written);
    if (who) overrides[`${hero.id}.eyebrow`] = `For ${lowerFirst(who)}`;
    const cares = words([...persona.motivations, ...persona.pains, persona.context].filter(written).join(" "));
    const best = brief.keyMessages
      .filter((m) => written(m.message) && m.message !== hero.heading)
      .map((m) => ({ m, score: [...words(`${m.message} ${m.support}`)].filter((w) => cares.has(w)).length }))
      .sort((a, b) => b.score - a.score)[0];
    if (best && best.score > 0) {
      overrides[`${hero.id}.heading`] = best.m.message;
      if (written(best.m.support)) overrides[`${hero.id}.lead`] = best.m.support;
    }
  }
  return { id: persona.id, personaId: persona.id, name: persona.name, slug: persona.id, overrides };
}

/** Builds the page from the brief's outline without a model. Used when no API key is set, and in tests. */
export function templatePageGenerator(): PageGenerator {
  return {
    name: "template",
    async generate({ brief, brand }): Promise<PageDraft> {
      const outline = brief.outline.length ? brief.outline : [{ type: "hero" as const, heading: brief.title, purpose: "", notes: "" }];
      const types = outline.map((s) => s.type);
      const cta = ctas(brief, types);
      const ids: string[] = [];
      let alternate = 0;
      const blocks = outline.map((s) => {
        const id = nextBlockId(s.type, ids);
        ids.push(id);
        const block = blockFor(s.type, s.heading, id, brief, brand, cta);
        // Sections alternate between plain and subtle bands; the closing CTA sits on the brand colour.
        const tone: Tone = s.type === "hero" ? "default" : s.type === "cta" ? "brand" : alternate++ % 2 ? "subtle" : "default";
        return { ...block, tone };
      });
      const hero = blocks.find((b): b is Extract<Block, { type: "hero" }> => b.type === "hero");
      return {
        title: brief.title,
        slug: brief.seo.slug,
        lang: brand.content?.[0]?.lang ?? "en",
        seo: { title: brief.seo.title, metaDescription: brief.seo.metaDescription },
        blocks,
        variants: brief.personas.map((p) => variantFor(p, brief, hero)),
      };
    },
  };
}
