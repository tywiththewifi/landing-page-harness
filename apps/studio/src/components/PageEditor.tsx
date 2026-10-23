import { createContext, Fragment, useContext, useState, type ReactNode } from "react";
import { FIELD_NAMES, FIELDS, type FieldName } from "@lph/forms";
import {
  BLOCK_NAMES,
  TONES,
  emptyBlock,
  formField,
  nextBlockId,
  valueIn,
  type Block,
  type BlockOf,
  type BlockType,
  type Page,
  type PageIssue,
  type Variant,
} from "@lph/page/browser";
import { PLACEHOLDER } from "@lph/brief/browser";
import type { Brand, CustomerLogo } from "@lph/tokens";
import { logoKey } from "@lph/ui";
import { SelectField, TextAreaField, TextField } from "./Fields.tsx";
import { ListEditor } from "./ListEditor.tsx";
import styles from "./PageEditor.module.scss";

/**
 * The page editor's left column. Copy is edited in place; structure (which sections, in
 * what order, items, form fields) only in the general page. In a persona's version every
 * text field writes an override instead, marked as personalised with a way back.
 */

export interface EditorApi {
  page: Page;
  brand: Brand;
  variant: Variant | null;
  /** Writes text: to the general page, or as the current version's override. */
  setText: (key: string, value: string) => void;
  resetText: (key: string) => void;
  /** Changes shared structure or props. The general page only. */
  update: (fn: (draft: Page) => void) => void;
  /** Leaves a persona's version for the general page, where sections are added and removed. */
  toGeneral?: () => void;
}

const Editor = createContext<EditorApi | null>(null);
const useEditor = () => useContext(Editor)!;

type Mutable<T extends BlockType> = (b: BlockOf<T>) => void;
/** Changes one block of the general page in place. */
const editBlock = <T extends BlockType>(api: EditorApi, block: BlockOf<T>, fn: Mutable<T>) =>
  api.update((d) => {
    const b = d.blocks.find((x) => x.id === block.id);
    if (b) fn(b as BlockOf<T>);
  });

function CopyField({ k, label, multiline, range, rows = 2, words }: { k: string; label: string; multiline?: boolean; range?: [number, number]; rows?: number; words?: boolean }) {
  const { page, variant, setText, resetText } = useEditor();
  const value = valueIn(page, variant, k) ?? "";
  const personal = !!variant && k in variant.overrides;
  const shown = words ? `${label} (${value.trim() ? value.trim().split(/\s+/).length : 0} words)` : label;
  return (
    <div className={`${styles.copy} ${personal ? styles.personal : ""}`} data-key={k}>
      {multiline ? (
        <TextAreaField label={shown} value={value} rows={rows} range={range} onChange={(v) => setText(k, v)} />
      ) : (
        <TextField label={shown} value={value} range={range} onChange={(v) => setText(k, v)} />
      )}
      {personal ? (
        <button type="button" className={styles.reset} onClick={() => resetText(k)}>
          Personalised for {variant!.name} · Use the general text
        </button>
      ) : null}
    </div>
  );
}

function LinkField({ block, slot, label }: { block: BlockOf<"hero"> | BlockOf<"cta">; slot: "primaryCta" | "secondaryCta"; label: string }) {
  const api = useEditor();
  return (
    <div className={styles.link}>
      <CopyField k={`${block.id}.${slot}.label`} label={label} />
      <label className={styles.href}>
        <span className="ui-label">Goes to</span>
        <input
          className="ui-input"
          list="lph-anchors"
          value={block[slot].href}
          placeholder="#form, /pricing or https://"
          disabled={!!api.variant}
          title={api.variant ? "Links are shared by every version. Change them in the general page." : undefined}
          onChange={(e) => editBlock(api, block, (b) => void (b[slot].href = e.target.value))}
        />
      </label>
    </div>
  );
}

/** A list of items: add, remove and reorder in the general page; text only in a version. */
function Items({ items, onChange, create, render, addLabel, label, min = 0 }: {
  items: unknown[];
  onChange: (next: unknown[]) => void;
  create: () => unknown;
  render: (i: number) => ReactNode;
  addLabel: string;
  label: (i: number) => string;
  min?: number;
}) {
  const { variant } = useEditor();
  if (variant) {
    return (
      <div className={styles.staticItems}>
        {items.map((_, i) => (
          <div key={i} className={styles.staticItem} role="group" aria-label={label(i)}>
            {render(i)}
          </div>
        ))}
      </div>
    );
  }
  return <ListEditor items={items} onChange={onChange} create={create} render={(_, __, i) => render(i)} addLabel={addLabel} label={label} min={min} />;
}

function BlockFields({ block }: { block: Block }) {
  const api = useEditor();
  const { brand, variant } = api;
  const id = block.id;
  const list = <K extends string>(key: K) => (next: unknown[]) => editBlock(api, block, (b) => void ((b as unknown as Record<K, unknown[]>)[key] = next));

  switch (block.type) {
    case "hero":
      return (
        <>
          <CopyField k={`${id}.eyebrow`} label="Eyebrow (optional)" />
          <CopyField k={`${id}.heading`} label="Headline (the page's H1)" range={[20, 70]} />
          <CopyField k={`${id}.lead`} label="Subheadline" multiline range={[60, 220]} />
          <div className={styles.row2}>
            <LinkField block={block} slot="primaryCta" label="Main button" />
            <LinkField block={block} slot="secondaryCta" label="Second button (optional)" />
          </div>
        </>
      );
    case "logos": {
      const logos = brand.customers ?? [];
      const unused = logos.filter((l) => !block.items.some((name) => logoKey(name) === logoKey(l.name)));
      const use = (logo: CustomerLogo) =>
        editBlock(api, block, (b) => {
          const gap = b.items.findIndex((name) => !name.trim() || name.includes(PLACEHOLDER));
          if (gap >= 0) b.items[gap] = logo.name;
          else b.items.push(logo.name);
        });
      return (
        <>
          <CopyField k={`${id}.heading`} label="Heading" />
          <Items
            items={block.items}
            onChange={list("items")}
            create={() => ""}
            addLabel="Add customer"
            label={(i) => `Customer ${i + 1}`}
            render={(i) => (
              <>
                <CopyField k={`${id}.items.${i}`} label="Customer name" />
                <LogoHint name={valueIn(api.page, variant, `${id}.items.${i}`) ?? ""} logos={logos} />
              </>
            )}
          />
          {!variant && unused.length ? (
            <div className={styles.siteLogos}>
              <span className="ui-label">Logos from the site</span>
              <div>
                {unused.map((l) => (
                  <button key={l.name} type="button" className={styles.siteLogo} onClick={() => use(l)} title={`Add ${l.name}`}>
                    <LogoThumb logo={l} />
                    <span>{l.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {!logos.length ? <p className={styles.hint}>No logo strip was found on the site, so customers show as their names. Names that match a logo from the site show as the logo.</p> : null}
        </>
      );
    }
    case "features":
      return (
        <>
          <div className={styles.row2}>
            <CopyField k={`${id}.eyebrow`} label="Eyebrow (optional)" />
            {variant ? null : (
              <SelectField
                label="Card style"
                value={block.cardVariant}
                options={brand.cards.length ? brand.cards.map((c) => [c.name, c.name] as [string, string]) : [["", "From the tokens"]]}
                onChange={(v) => editBlock(api, block, (b) => void (b.cardVariant = v))}
              />
            )}
          </div>
          <CopyField k={`${id}.heading`} label="Heading" />
          <CopyField k={`${id}.intro`} label="Intro (optional)" multiline />
          <Items
            items={block.items}
            onChange={list("items")}
            create={() => ({ title: "", body: "" })}
            addLabel="Add feature"
            label={(i) => `Feature ${i + 1}`}
            render={(i) => (
              <>
                <CopyField k={`${id}.items.${i}.title`} label="Title" />
                <CopyField k={`${id}.items.${i}.body`} label="Text" multiline />
              </>
            )}
          />
        </>
      );
    case "steps":
      return (
        <>
          <CopyField k={`${id}.heading`} label="Heading" />
          <CopyField k={`${id}.intro`} label="Intro (optional)" multiline />
          <Items
            items={block.items}
            onChange={list("items")}
            create={() => ({ title: "", body: "" })}
            addLabel="Add step"
            label={(i) => `Step ${i + 1}`}
            render={(i) => (
              <>
                <CopyField k={`${id}.items.${i}.title`} label="Step" />
                <CopyField k={`${id}.items.${i}.body`} label="Text" multiline />
              </>
            )}
          />
        </>
      );
    case "stats":
      return (
        <>
          <CopyField k={`${id}.heading`} label="Heading (optional)" />
          <p className={styles.hint}>Only real numbers from your site, its data or the brief's proof. Anything else is flagged.</p>
          <Items
            items={block.items}
            onChange={list("items")}
            create={() => ({ value: "", label: "" })}
            addLabel="Add stat"
            label={(i) => `Stat ${i + 1}`}
            render={(i) => (
              <div className={styles.rowNarrow}>
                <CopyField k={`${id}.items.${i}.value`} label="Number" />
                <CopyField k={`${id}.items.${i}.label`} label="What it measures" />
              </div>
            )}
          />
        </>
      );
    case "testimonial":
      return (
        <>
          <p className={styles.hint}>A real customer's words, with their permission to publish.</p>
          <CopyField k={`${id}.quote`} label="Quote" multiline rows={3} />
          <div className={styles.row3}>
            <CopyField k={`${id}.name`} label="Name" />
            <CopyField k={`${id}.role`} label="Role" />
            <CopyField k={`${id}.company`} label="Company" />
          </div>
        </>
      );
    case "comparison":
      return (
        <>
          <CopyField k={`${id}.heading`} label="Heading" />
          <CopyField k={`${id}.intro`} label="Intro (optional)" multiline />
          <div className={styles.row2}>
            <CopyField k={`${id}.columns.ours`} label="Our column" />
            <CopyField k={`${id}.columns.theirs`} label="Their column" />
          </div>
          <Items
            items={block.rows}
            onChange={list("rows")}
            create={() => ({ label: "", ours: "", theirs: "" })}
            addLabel="Add row"
            label={(i) => `Row ${i + 1}`}
            render={(i) => (
              <div className={styles.row3}>
                <CopyField k={`${id}.rows.${i}.label`} label="Row" />
                <CopyField k={`${id}.rows.${i}.ours`} label="Ours" />
                <CopyField k={`${id}.rows.${i}.theirs`} label="Theirs" />
              </div>
            )}
          />
        </>
      );
    case "faq":
      return (
        <>
          <CopyField k={`${id}.heading`} label="Heading" />
          <p className={styles.hint}>Marked up as FAQPage. Answer engines quote direct answers of 40 to 60 words.</p>
          <Items
            items={block.items}
            onChange={list("items")}
            create={() => ({ question: "", answer: "" })}
            addLabel="Add question"
            label={(i) => `Question ${i + 1}`}
            render={(i) => (
              <>
                <CopyField k={`${id}.items.${i}.question`} label="Question" />
                <CopyField k={`${id}.items.${i}.answer`} label="Answer" multiline rows={3} words />
              </>
            )}
          />
        </>
      );
    case "form":
      return (
        <>
          <CopyField k={`${id}.heading`} label="Heading" />
          <CopyField k={`${id}.intro`} label="Intro (optional)" multiline />
          <span className="ui-label">Fields</span>
          {variant ? (
            <div className={styles.staticItems}>
              {block.fields.map((f, i) => (
                <CopyField key={f.name} k={`${id}.fields.${i}.label`} label={`Label for ${f.name}`} />
              ))}
            </div>
          ) : (
            <ListEditor
              items={block.fields}
              onChange={list("fields")}
              label={(i) => `Field ${i + 1}`}
              addLabel="Add field"
              create={() => {
                const unused = FIELD_NAMES.find((n) => !block.fields.some((f) => f.name === n)) ?? "message";
                return formField(unused);
              }}
              render={(f, set) => (
                <div className={styles.formField}>
                  <SelectField<FieldName>
                    label="Asks for"
                    value={f.name}
                    options={FIELD_NAMES.map((n) => [n, `${FIELDS[n].label} (${n})`] as [FieldName, string])}
                    onChange={(name) => set({ ...f, name, label: f.label === FIELDS[f.name].label ? FIELDS[name].label : f.label })}
                  />
                  <TextField label="Label" value={f.label} onChange={(label) => set({ ...f, label })} />
                  <label className={styles.check}>
                    <input type="checkbox" checked={f.required} onChange={(e) => set({ ...f, required: e.target.checked })} />
                    Required
                  </label>
                </div>
              )}
            />
          )}
          <CopyField k={`${id}.submitLabel`} label="Button" />
          <CopyField k={`${id}.consent`} label="Under the button: what the details are used for" multiline />
          <CopyField k={`${id}.successMessage`} label="Thank-you message" />
        </>
      );
    case "cta":
      return (
        <>
          <CopyField k={`${id}.heading`} label="Heading" />
          <CopyField k={`${id}.body`} label="Text (optional)" multiline />
          <div className={styles.row2}>
            <LinkField block={block} slot="primaryCta" label="Main button" />
            <LinkField block={block} slot="secondaryCta" label="Second button (optional)" />
          </div>
        </>
      );
  }
}

const TONE_NAMES: Record<(typeof TONES)[number], string> = { default: "Plain", subtle: "Subtle band", brand: "Brand colour" };

/** A customer's logo as imported. The SVG was sanitised then (no scripts, handlers or outside links). */
function LogoThumb({ logo }: { logo: CustomerLogo }) {
  return logo.svg ? <span className={styles.logoThumb} aria-hidden="true" dangerouslySetInnerHTML={{ __html: logo.svg }} /> : <img className={styles.logoThumb} src={logo.src} alt="" />;
}

/** Whether a name in a logo row shows as a logo. */
function LogoHint({ name, logos }: { name: string; logos: CustomerLogo[] }) {
  if (!name.trim() || name.includes(PLACEHOLDER)) return null;
  const logo = logos.find((l) => logoKey(l.name) === logoKey(name));
  return (
    <span className={styles.logoHint}>
      {logo ? (
        <>
          <LogoThumb logo={logo} /> Shows the logo from the site
        </>
      ) : (
        "Shown as text: no logo from the site has this name"
      )}
    </span>
  );
}

function BlockCard({ block, index, count, open, onToggle, onRemove, issues }: { block: Block; index: number; count: number; open: boolean; onToggle: () => void; onRemove: () => void; issues: number }) {
  const api = useEditor();
  const move = (to: number) =>
    api.update((d) => {
      const [b] = d.blocks.splice(index, 1);
      d.blocks.splice(to, 0, b!);
    });
  return (
    <section id={`block-${block.id}`} className={styles.block} aria-label={BLOCK_NAMES[block.type]}>
      <header className={styles.blockHead}>
        <button type="button" className={styles.toggle} aria-expanded={open} onClick={onToggle}>
          <span className={styles.chevron} aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
          <strong>{BLOCK_NAMES[block.type]}</strong>
          <code>#{block.id}</code>
          {issues ? <span className={styles.count}>{issues}</span> : null}
        </button>
        {api.variant ? null : (
          <div className={styles.blockControls}>
            {block.type === "hero" ? null : (
              <select
                className={styles.tone}
                aria-label={`${BLOCK_NAMES[block.type]} background`}
                value={block.tone}
                onChange={(e) => api.update((d) => void (d.blocks[index]!.tone = e.target.value as Block["tone"]))}
              >
                {TONES.map((t) => (
                  <option key={t} value={t}>
                    {TONE_NAMES[t]}
                  </option>
                ))}
              </select>
            )}
            <button type="button" onClick={() => move(index - 1)} disabled={index === 0} aria-label={`Move ${BLOCK_NAMES[block.type]} up`} title="Move up">
              ↑
            </button>
            <button type="button" onClick={() => move(index + 1)} disabled={index === count - 1} aria-label={`Move ${BLOCK_NAMES[block.type]} down`} title="Move down">
              ↓
            </button>
            {/* The hero holds the page's H1, and can't be added back. */}
            {block.type === "hero" ? null : (
              <button type="button" className={styles.remove} onClick={onRemove} aria-label={`Remove ${BLOCK_NAMES[block.type]}`}>
                <span aria-hidden="true">✕</span> Remove
              </button>
            )}
          </div>
        )}
      </header>
      {open ? (
        <div className={styles.blockBody}>
          <BlockFields block={block} />
        </div>
      ) : null}
    </section>
  );
}

const ADDABLE = Object.keys(BLOCK_NAMES).filter((t) => t !== "hero") as BlockType[];

export function PageEditor({ api, issues, open, setOpen }: { api: EditorApi; issues: PageIssue[]; open: Set<string>; setOpen: (next: Set<string>) => void }) {
  const { page, variant } = api;
  const [adding, setAdding] = useState<BlockType>("features");
  // The last section removed, to put back.
  const [removed, setRemoved] = useState<{ block: Block; index: number } | null>(null);
  const remove = (index: number) => {
    const block = page.blocks[index]!;
    api.update((d) => void d.blocks.splice(index, 1));
    setRemoved({ block, index });
  };
  const undo = () => {
    if (!removed) return;
    api.update((d) => {
      // A section added since may have taken its id.
      const taken = d.blocks.map((b) => b.id);
      const block = taken.includes(removed.block.id) ? { ...removed.block, id: nextBlockId(removed.block.type, taken) } : removed.block;
      d.blocks.splice(Math.min(removed.index, d.blocks.length), 0, block);
    });
    setRemoved(null);
  };
  const removedBar = removed ? (
    <div className={styles.removed} role="status">
      <span>
        Removed <strong>{BLOCK_NAMES[removed.block.type]}</strong>.
      </span>
      <button type="button" className="ui-button ui-button--small" onClick={undo}>
        Undo
      </button>
      <button type="button" className={styles.dismiss} onClick={() => setRemoved(null)} aria-label="Dismiss">
        ✕
      </button>
    </div>
  ) : null;
  const toggle = (id: string) => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpen(next);
  };
  const add = () => {
    const id = nextBlockId(adding, page.blocks.map((b) => b.id));
    const hero = page.blocks.find((b) => b.type === "hero");
    api.update((d) => void d.blocks.push(emptyBlock(adding, id, { cardVariant: api.brand.cards[0]?.name, cta: hero?.type === "hero" ? hero.primaryCta.label : undefined, customers: api.brand.customers?.map((c) => c.name) })));
    setOpen(new Set(open).add(id));
  };
  const counted = (area: string) => issues.filter((i) => i.area === area && i.severity !== "info" && (i.variant ?? null) === (variant?.id ?? null)).length;

  return (
    <Editor.Provider value={api}>
      <datalist id="lph-anchors">
        {page.blocks.map((b) => (
          <option key={b.id} value={`#${b.id}`}>
            {BLOCK_NAMES[b.type]}
          </option>
        ))}
      </datalist>
      {variant ? (
        <p className={styles.variantNote}>
          Editing <strong>{variant.name}</strong>. Text you change here is personalised for this version; everything else is shared with the general page. Sections, items and links are added, removed and moved in the general page.
          {api.toGeneral ? (
            <>
              {" "}
              <button type="button" className={styles.linkButton} onClick={api.toGeneral}>
                Edit the general page
              </button>
            </>
          ) : null}
        </p>
      ) : null}
      <section id="block-seo" className={styles.block} aria-label="Page and SEO">
        <header className={styles.blockHead}>
          <button type="button" className={styles.toggle} aria-expanded={open.has("seo")} onClick={() => toggle("seo")}>
            <span className={styles.chevron} aria-hidden="true">
              {open.has("seo") ? "▾" : "▸"}
            </span>
            <strong>Page &amp; SEO</strong>
            {counted("seo") ? <span className={styles.count}>{counted("seo")}</span> : null}
          </button>
        </header>
        {open.has("seo") ? (
          <div className={styles.blockBody}>
            {variant ? null : (
              <div className={styles.rowWide}>
                <TextField label="Page name (internal)" value={page.title} onChange={(v) => api.update((d) => void (d.title = v))} />
                <TextField label="URL" prefix="/" value={page.slug} onChange={(v) => api.update((d) => void (d.slug = v))} />
              </div>
            )}
            <CopyField k="seo.title" label="Title tag" range={[30, 60]} />
            <CopyField k="seo.metaDescription" label="Meta description" multiline range={[120, 160]} />
          </div>
        ) : null}
      </section>
      {page.blocks.map((b, i) => (
        <Fragment key={b.id}>
          {removed && removed.index === i && !variant ? removedBar : null}
          <BlockCard block={b} index={i} count={page.blocks.length} open={open.has(b.id)} onToggle={() => toggle(b.id)} onRemove={() => remove(i)} issues={counted(b.id)} />
        </Fragment>
      ))}
      {removed && removed.index >= page.blocks.length && !variant ? removedBar : null}
      {variant ? null : (
        <div className={styles.add}>
          <select className="ui-input" aria-label="Section to add" value={adding} onChange={(e) => setAdding(e.target.value as BlockType)}>
            {ADDABLE.map((t) => (
              <option key={t} value={t}>
                {BLOCK_NAMES[t]}
              </option>
            ))}
          </select>
          <button type="button" className="ui-button" onClick={add}>
            + Add section
          </button>
        </div>
      )}
    </Editor.Provider>
  );
}
