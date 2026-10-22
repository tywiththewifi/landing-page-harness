import type { GateReport } from "@lph/checks/browser";
import type { Page } from "@lph/page/browser";
import type { PageSource, SiteFile } from "./site.ts";

export interface FileChange {
  path: string;
  kind: SiteFile["kind"] | "other";
  status: "added" | "changed" | "removed" | "unchanged";
}

export interface Classification {
  /** content: copy only, so it can merge itself once the checks pass. review: a person approves it. */
  risk: "content" | "review";
  reasons: string[];
}

export const LABELS = { content: "lph:content", review: "lph:needs-review" } as const;

/**
 * Everything about a page that isn't copy: which sections it has and in what order,
 * their backgrounds and card styles, where buttons go, the form's fields and where its
 * leads go, its URL and each version's URL. Copy, SEO text and version overrides are not
 * part of it.
 */
export function structureOf(page: Page) {
  return {
    slug: page.slug,
    lang: page.lang,
    blocks: page.blocks.map((b) => ({
      id: b.id,
      type: b.type,
      tone: b.tone,
      ...("cardVariant" in b && { cardVariant: b.cardVariant }),
      ...("primaryCta" in b && { links: [b.primaryCta.href, b.secondaryCta.href] }),
      ...(b.type === "form" && { fields: b.fields.map((f) => [f.name, f.required]) }),
    })),
    form: page.form,
    versions: page.variants.map((v) => [v.id, v.slug, v.personaId]),
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Decides whether a publish can merge itself. Only a copy change to a page that's
 * already live, with the same tokens and components and no change to shared files,
 * passing every check, is low risk. Anything else needs a reviewer, and says why.
 * The site's CI runs this too, from the diff itself, so a label can't be added by hand
 * to skip review.
 */
export function classify(before: PageSource | null, after: PageSource, changes: FileChange[], verdict?: GateReport["verdict"] | null): Classification {
  const reasons: string[] = [];
  if (!before) reasons.push("It's a new page, so a person checks it once before it goes live.");
  else {
    const a = structureOf(before.page);
    const b = structureOf(after.page);
    if (a.slug !== b.slug) reasons.push(`The page moves from /${a.slug} to /${b.slug}.`);
    if (a.lang !== b.lang) reasons.push("The page's language changed.");
    const shape = (s: typeof a) => s.blocks.map((x) => `${x.id}:${x.type}`);
    if (!same(shape(a), shape(b))) reasons.push("Sections were added, removed or reordered.");
    const looks = (s: typeof a) => s.blocks.map((x) => [x.id, x.tone, "cardVariant" in x ? x.cardVariant : null]);
    if (!same(looks(a), looks(b)) && same(shape(a), shape(b))) reasons.push("A section's background or card style changed.");
    const links = (s: typeof a) => s.blocks.map((x) => ("links" in x ? x.links : null));
    if (!same(links(a), links(b)) && same(shape(a), shape(b))) reasons.push("Where a button links changed.");
    const form = (s: typeof a) => [s.form, s.blocks.map((x) => ("fields" in x ? x.fields : null))];
    if (!same(form(a), form(b))) reasons.push("The form, or where its leads go, changed.");
    if (!same(a.versions, b.versions)) reasons.push("A version was added, removed or moved to a new URL.");
    if (before.build.tokens !== after.build.tokens) reasons.push("The brand's tokens changed since the page was last published.");
    if (before.build.components !== after.build.components) reasons.push("The component library changed since the page was last published.");
  }
  const shared = changes.filter((c) => (c.kind === "config" || c.kind === "other") && c.status !== "unchanged");
  if (shared.length && before) reasons.push(`Shared site files change: ${shared.map((c) => c.path).join(", ")}.`);
  if (verdict === "review") reasons.push("The checks found warnings a person has to accept.");
  if (verdict === "blocked") reasons.push("The checks found errors.");
  return reasons.length ? { risk: "review", reasons } : { risk: "content", reasons: ["Copy only, on a page that's already live: it merges itself once the checks pass."] };
}
