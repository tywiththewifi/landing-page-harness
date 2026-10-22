import { PLACEHOLDER } from "@lph/brief/browser";
import { FIELDS, type FieldName } from "@lph/forms";
import type { Block, BlockOf, BlockType } from "./schema.ts";

/** "features", then "features-2": readable anchors that stay put when blocks move. */
export function nextBlockId(type: BlockType, taken: Iterable<string>): string {
  const used = new Set(taken);
  let id: string = type;
  for (let i = 2; used.has(id); i++) id = `${type}-${i}`;
  return id;
}

export const formField = (name: FieldName, required = false) => ({ name, label: FIELDS[name].label, required });

const todo = (what: string) => `${PLACEHOLDER} ${what}`;
const items = (n: number, what: string) => Array.from({ length: n }, (_, i) => ({ title: todo(`${what} ${i + 1}`), body: PLACEHOLDER }));

/** A new block with placeholders for every piece of copy, as the editor's "Add block" creates it. */
export function emptyBlock<T extends BlockType>(type: T, id: string, opts: { cardVariant?: string; cta?: string } = {}): BlockOf<T> {
  const cta = { label: opts.cta ?? todo("Button"), href: "#form" };
  const none = { label: "", href: "" };
  const blocks: { [K in BlockType]: Omit<BlockOf<K>, "id" | "tone"> } = {
    hero: { type: "hero", eyebrow: "", heading: todo("Headline"), lead: todo("Subheadline"), primaryCta: cta, secondaryCta: none },
    logos: { type: "logos", heading: todo("Heading"), items: Array.from({ length: 5 }, (_, i) => todo(`Customer ${i + 1}`)) },
    features: { type: "features", eyebrow: "", heading: todo("Heading"), intro: "", items: items(3, "Benefit"), cardVariant: opts.cardVariant ?? "default" },
    steps: { type: "steps", heading: todo("Heading"), intro: "", items: items(3, "Step") },
    stats: { type: "stats", heading: "", items: Array.from({ length: 3 }, () => ({ value: PLACEHOLDER, label: todo("What it measures") })) },
    testimonial: { type: "testimonial", quote: todo("A real customer quote, with permission"), name: PLACEHOLDER, role: PLACEHOLDER, company: PLACEHOLDER },
    comparison: {
      type: "comparison",
      heading: todo("Heading"),
      intro: "",
      columns: { ours: todo("Us"), theirs: "The old way" },
      rows: Array.from({ length: 3 }, (_, i) => ({ label: todo(`Point ${i + 1}`), ours: PLACEHOLDER, theirs: PLACEHOLDER })),
    },
    faq: { type: "faq", heading: "Frequently asked questions", items: [{ question: todo("Question"), answer: todo("A direct 40 to 60 word answer.") }] },
    form: {
      type: "form",
      heading: opts.cta ?? todo("Heading"),
      intro: "",
      fields: [formField("email", true), formField("firstname", true), formField("company")],
      submitLabel: opts.cta ?? "Submit",
      successMessage: "Thanks, we'll be in touch soon.",
      consent: "We'll only use these details to reply to your request.",
    },
    cta: { type: "cta", heading: todo("Heading"), body: "", primaryCta: cta, secondaryCta: none },
  };
  return { id, tone: type === "cta" ? "brand" : "default", ...blocks[type] } as unknown as BlockOf<T>;
}

/** Placeholder-free and not blank. */
export const written = (s: string | undefined): s is string => !!s?.trim() && !s.includes(PLACEHOLDER);

/** The H1: the hero's heading. */
export const heroOf = (blocks: Block[]) => blocks.find((b): b is BlockOf<"hero"> => b.type === "hero");

/** Only links that go somewhere safe: a section, a path on the site, https, mail or phone. */
export const SAFE_HREF = /^(#[a-z0-9-]*|\/(?!\/)\S*|https?:\/\/\S+|mailto:\S+|tel:[+\d\s().-]+)$/i;
export const safeHref = (href: string) => (SAFE_HREF.test(href.trim()) ? href.trim() : "#");
