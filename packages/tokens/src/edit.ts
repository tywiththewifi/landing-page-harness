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
  next.conflicts = next.conflicts.map((c) => (c.id === conflictId ? { ...c, resolved: value } : c));

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
