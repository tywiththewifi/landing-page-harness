import type { Brief } from "@lph/brief/schema";
import { applyVariant, keyLabel, versionPath, type Page, type PageIssue, type Variant } from "@lph/page/browser";
import styles from "./VersionsTable.module.scss";

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Every version of the page side by side: the general page and one per persona, each on
 * its own URL, with the hero copy a visitor sees first and what was personalised.
 */
export function VersionsTable({
  page,
  brief,
  issues,
  update,
  onEdit,
}: {
  page: Page;
  brief: Brief;
  issues: PageIssue[];
  update: (fn: (draft: Page) => void) => void;
  onEdit: (variantId: string | null) => void;
}) {
  const rows: (Variant | null)[] = [null, ...page.variants];
  const missing = brief.personas.filter((p) => !page.variants.some((v) => v.personaId === p.id));
  const problems = (v: Variant | null) => issues.filter((i) => (i.variant ?? null) === (v?.id ?? null) && i.severity !== "info").length;

  return (
    <div className={styles.wrap}>
      <p className={styles.intro}>
        Each persona gets its own URL with its own hero. Everything else is shared with the general page, so a fix there reaches every version. Versions point search
        engines at the general page, so they're for email, outreach and ads rather than search.
      </p>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Version</th>
              <th scope="col">URL</th>
              <th scope="col">H1</th>
              <th scope="col">Subheadline</th>
              <th scope="col">CTA</th>
              <th scope="col">Personalised</th>
              <th scope="col">
                <span className="ui-visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => {
              const view = applyVariant(page, v);
              const hero = view.blocks.find((b) => b.type === "hero");
              const keys = Object.keys(v?.overrides ?? {});
              const count = problems(v);
              return (
                <tr key={v?.id ?? "general"}>
                  <th scope="row">
                    {v ? (
                      <input
                        className={`ui-input ${styles.cell}`}
                        aria-label="Version name"
                        value={v.name}
                        onChange={(e) => update((d) => void (d.variants.find((x) => x.id === v.id)!.name = e.target.value))}
                      />
                    ) : (
                      <strong>General</strong>
                    )}
                    {count ? <span className={styles.badge}>{count} to fix</span> : null}
                  </th>
                  <td className={styles.url}>
                    {v ? (
                      <span className={styles.slug}>
                        <span>/{page.slug}/</span>
                        <input
                          className={`ui-input ${styles.cell}`}
                          aria-label={`URL for ${v.name}`}
                          value={v.slug}
                          onChange={(e) => update((d) => void (d.variants.find((x) => x.id === v.id)!.slug = e.target.value))}
                          onBlur={(e) => update((d) => void (d.variants.find((x) => x.id === v.id)!.slug = slugify(e.target.value)))}
                        />
                      </span>
                    ) : (
                      <code>{versionPath(page, null)}</code>
                    )}
                  </td>
                  <td>{hero?.type === "hero" ? hero.heading : "–"}</td>
                  <td className={styles.muted}>{hero?.type === "hero" ? hero.lead : "–"}</td>
                  <td>{hero?.type === "hero" ? hero.primaryCta.label : "–"}</td>
                  <td>
                    {v ? (
                      keys.length ? (
                        <span className={styles.chips}>
                          {keys.map((k) => (
                            <span key={k} className={styles.chip}>
                              {keyLabel(page, k)}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className={styles.muted}>Nothing yet</span>
                      )
                    ) : (
                      <span className={styles.muted}>Base for every version</span>
                    )}
                  </td>
                  <td className={styles.actions}>
                    <button type="button" className="ui-button ui-button--small" onClick={() => onEdit(v?.id ?? null)}>
                      Edit
                    </button>
                    {v ? (
                      <button
                        type="button"
                        className="ui-button ui-button--small ui-button--ghost"
                        aria-label={`Remove ${v.name}`}
                        onClick={() => update((d) => void (d.variants = d.variants.filter((x) => x.id !== v.id)))}
                      >
                        Remove
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {missing.length ? (
        <div className={styles.missing}>
          {missing.map((p) => (
            <button
              key={p.id}
              type="button"
              className="ui-button ui-button--small"
              onClick={() =>
                update((d) => {
                  const taken = new Set(d.variants.map((v) => v.slug));
                  let slug = p.id;
                  for (let i = 2; taken.has(slug); i++) slug = `${p.id}-${i}`;
                  d.variants.push({ id: slug, personaId: p.id, name: p.name, slug, overrides: {} });
                })
              }
            >
              + Version for {p.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
