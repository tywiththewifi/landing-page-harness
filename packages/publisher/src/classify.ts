import type { GateReport } from "@lph/checks/browser";
import { valueIn, type Page } from "@lph/page/browser";
import type { PageSource, SiteFile, WarningRef } from "./site.ts";

export interface FileChange {
  path: string;
  kind: SiteFile["kind"] | "other";
  status: "added" | "changed" | "removed" | "unchanged";
  /** For a changed page: more than its words changed (see htmlSkeleton). */
  beyondCopy?: boolean;
}

export interface Classification {
  /** content: copy only, so it can merge itself once the checks pass. review: a person approves it. */
  risk: "content" | "review";
  reasons: string[];
}

export const LABELS = { content: "lph:content", review: "lph:needs-review" } as const;

/**
 * Everything about a page that isn't copy: which sections it has and in what order,
 * how many items each holds, their backgrounds and card styles, where buttons go, the
 * form's fields and where its leads go, its URL and each version's URL. Copy, SEO text
 * and version overrides are not part of it.
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
      items: Object.entries(b).flatMap(([k, v]) => (Array.isArray(v) ? [[k, v.length]] : [])),
      ...("primaryCta" in b && { links: [b.primaryCta.href, b.secondaryCta.href] }),
      ...(b.type === "form" && { fields: b.fields.map((f) => [f.name, f.required]) }),
    })),
    form: page.form,
    versions: page.variants.map((v) => [v.id, v.slug, v.personaId]),
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const keyOf = (w: WarningRef) => [w.check, w.id, w.path ?? "", w.field ?? "", w.variant ?? ""].join("\u0000");

/**
 * A warning on the live page was accepted by whoever merged it, so it doesn't send the
 * next copy change back to a reviewer. Unless it's about a field, and that field's
 * text changed: a new quote is checked again, even if the old one was fine.
 */
function accepted(before: PageSource, after: PageSource, w: WarningRef): boolean {
  if (!(before.gate?.warnings ?? []).some((a) => keyOf(a) === keyOf(w))) return false;
  if (!w.field) return true;
  const text = (s: PageSource) => valueIn(s.page, w.variant ? s.page.variants.find((v) => v.id === w.variant) : null, w.field!);
  return text(before) === text(after);
}

/** What the gate found, as classify needs it: the studio's report, or the site CI's together with it. */
export interface GateFindings {
  verdict: GateReport["verdict"];
  warnings: WarningRef[];
}

/**
 * Decides whether a publish can merge itself. Only a copy change to a page that's
 * already live, with the same tokens and components and no change to shared files,
 * passing every check (or with only warnings a reviewer accepted on the live page), is
 * low risk. Anything else needs a reviewer, and says why.
 * The site's CI runs this too, from the diff itself, so a label can't be added by hand
 * to skip review.
 */
export function classify(before: PageSource | null, after: PageSource, changes: FileChange[], gate?: GateFindings | null): Classification {
  const reasons: string[] = [];
  if (!before) reasons.push("It's a new page, so a person checks it once before it goes live.");
  else {
    const a = structureOf(before.page);
    const b = structureOf(after.page);
    if (a.slug !== b.slug) reasons.push(`The page moves from /${a.slug} to /${b.slug}.`);
    if (a.lang !== b.lang) reasons.push("The page's language changed.");
    const shape = (s: typeof a) => s.blocks.map((x) => `${x.id}:${x.type}`);
    if (!same(shape(a), shape(b))) reasons.push("Sections were added, removed or reordered.");
    const items = (s: typeof a) => s.blocks.map((x) => x.items);
    if (!same(items(a), items(b)) && same(shape(a), shape(b))) reasons.push("Items were added to or removed from a section.");
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
  // A safety net under the rules above: whatever the source says, the HTML itself changed in more than words.
  const rebuilt = changes.filter((c) => c.kind === "page" && c.status === "changed" && c.beyondCopy);
  if (before && rebuilt.length && !reasons.length) reasons.push(`More than the words changed in ${rebuilt.map((c) => c.path).join(", ")}: its tags, links, scripts or styles.`);
  const shared = changes.filter((c) => (c.kind === "config" || c.kind === "other") && c.status !== "unchanged");
  if (shared.length && before) reasons.push(`Shared site files change: ${shared.map((c) => c.path).join(", ")}.`);
  // The studio and CI often find the same warning: count it once.
  const warnings = [...new Map((gate?.warnings ?? []).map((w) => [keyOf(w), w])).values()];
  const fresh = before ? warnings.filter((w) => !accepted(before, after, w)) : warnings;
  if (gate?.verdict === "review" && (fresh.length || !warnings.length)) {
    reasons.push(
      fresh.length && before
        ? `The checks found ${fresh.length === 1 ? "a new warning" : `${fresh.length} new warnings`} a person has to accept: ${[...new Set(fresh.map((w) => w.id))].join(", ")}.`
        : "The checks found warnings a person has to accept.",
    );
  }
  if (gate?.verdict === "blocked") reasons.push("The checks found errors.");
  if (reasons.length) return { risk: "review", reasons };
  const kept = warnings.length - fresh.length;
  return {
    risk: "content",
    reasons: [
      "Only copy changed, on a page that's already live.",
      ...(kept ? [`${kept === 1 ? "One warning was" : `${kept} warnings were`} accepted when the live page was reviewed, and ${kept === 1 ? "its" : "their"} text hasn't changed.`] : []),
    ],
  };
}
