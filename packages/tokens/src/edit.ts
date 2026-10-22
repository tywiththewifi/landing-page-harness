import type { Brand } from "./types.ts";

const HEADING_ROLES = new Set(["display", "h1", "h2", "h3", "h4"]);

/**
 * Applies the user's choice for a conflict. Font conflicts also update every
 * type token that used the previous family, so the scale stays consistent.
 */
export function resolveConflict(brand: Brand, conflictId: string, value: string): Brand {
  const conflict = brand.conflicts.find((c) => c.id === conflictId);
  if (!conflict) throw new Error(`Unknown conflict ${conflictId}`);
  if (!conflict.options.some((o) => o.value === value)) throw new Error(`"${value}" is not an option for ${conflictId}`);

  const next: Brand = structuredClone(brand);
  next.conflicts = next.conflicts.map((c) => (c.id === conflictId ? { ...c, resolved: value, reviewed: true } : c));

  if (conflict.field === "fonts.heading" || conflict.field === "fonts.body") {
    const key = conflict.field === "fonts.heading" ? "heading" : "body";
    const previous = next.fonts[key];
    next.fonts[key] = value;
    for (const t of next.typography) {
      const applies = key === "heading" ? HEADING_ROLES.has(t.role) : !HEADING_ROLES.has(t.role);
      if (applies && t.fontFamily === previous) t.fontFamily = value;
    }
    next.summary = next.summary.split(previous).join(value);
    next.usageRules = next.usageRules.map((r) => r.split(previous).join(value));
  }
  next.updatedAt = new Date().toISOString();
  return next;
}

/**
 * Changes a palette colour everywhere it is used: components that were measured
 * with the old value, plus the summary and rules that mention it. This is what
 * makes editing a token behave like editing a design system rather than a swatch.
 */
export function replaceColor(brand: Brand, from: string, to: string): Brand {
  const next: Brand = structuredClone(brand);
  const a = from.toLowerCase();
  const swap = (v: string | null) => (v && v.toLowerCase() === a ? to : v);
  for (const c of next.colors) c.value = swap(c.value)!;
  for (const b of next.buttons) {
    b.background = swap(b.background);
    b.color = swap(b.color)!;
    b.borderColor = swap(b.borderColor);
    b.context = swap(b.context)!;
  }
  for (const c of next.cards) {
    c.background = swap(c.background)!;
    c.borderColor = swap(c.borderColor);
    c.context = swap(c.context)!;
  }
  if (next.input) {
    next.input.background = swap(next.input.background)!;
    next.input.color = swap(next.input.color)!;
    next.input.borderColor = swap(next.input.borderColor);
  }
  const re = new RegExp(a, "gi");
  next.summary = next.summary.replace(re, to);
  next.usageRules = next.usageRules.map((r) => r.replace(re, to));
  next.updatedAt = new Date().toISOString();
  return next;
}
