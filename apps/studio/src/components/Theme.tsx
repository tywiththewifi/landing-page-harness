import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { checkContrast, replaceColor, type Brand, type ButtonStyle, type ColorToken, type TypeToken } from "@lph/tokens";
import { Confidence } from "./Confidence.tsx";
import { ColorField, NumberField, TextField, WeightField } from "./Fields.tsx";
import styles from "./Theme.module.scss";

type Update = (fn: (draft: Brand) => void) => void;

const SECTIONS = [
  ["overview", "Overview"],
  ["color", "Colour"],
  ["type", "Typography"],
  ["logo", "Logo"],
  ["ui", "UI elements"],
  ["radius", "Radius"],
  ["spacing", "Spacing"],
  ["rules", "Usage rules"],
] as const;

const ROLE_GROUPS: [string, ColorToken["role"][]][] = [
  ["Brand", ["brand", "accent"]],
  ["Text and surfaces", ["ink", "surface"]],
  ["Neutrals", ["neutral"]],
];

const family = (f: string) => `"${f}", system-ui, sans-serif`;

export function Theme({ brand, update, resolve }: { brand: Brand; update: Update; resolve: (id: string, value: string) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string>("overview");

  // Highlight the section currently in view.
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id.replace("section-", ""));
      },
      { root, rootMargin: "0px 0px -70% 0px" },
    );
    root.querySelectorAll("section[id^=section-]").forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, []);

  const jump = (id: string) => {
    const root = scroller.current;
    const el = root?.querySelector<HTMLElement>(`#section-${id}`);
    if (root && el) root.scrollTo({ top: el.offsetTop - 8, behavior: "smooth" });
    setActive(id);
  };

  return (
    <div className={styles.layout}>
      <nav className={styles.nav} aria-label="Theme sections">
        {SECTIONS.map(([id, label]) => (
          <button key={id} className={active === id ? styles.navOn : undefined} onClick={() => jump(id)}>
            {label}
          </button>
        ))}
      </nav>
      <div className={styles.content} ref={scroller}>
        <Overview brand={brand} update={update} resolve={resolve} />
        <Colors brand={brand} update={update} />
        <Typography brand={brand} update={update} />
        <LogoSection brand={brand} />
        <UiElements brand={brand} update={update} />
        <Radius brand={brand} update={update} />
        <Spacing brand={brand} update={update} />
        <Rules brand={brand} update={update} />
      </div>
    </div>
  );
}

function Section({ id, title, intro, action, children }: { id: string; title: string; intro?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section id={`section-${id}`} className={styles.section}>
      <div className={styles.sectionHead}>
        <div>
          <h2>{title}</h2>
          {intro ? <p>{intro}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

// --- Overview -------------------------------------------------------------------------------

function Overview({ brand, update, resolve }: { brand: Brand; update: Update; resolve: (id: string, value: string) => void }) {
  const contrast = checkContrast(brand);
  const failing = contrast.filter((c) => c.level === "fail" || c.level === "AA-large");
  const conflicts = brand.conflicts.filter((c) => c.options.length > 1);
  const chips = [
    `${brand.colors.length} colours`,
    `${brand.typography.length} type tokens`,
    `${brand.radii.length} radius tokens`,
    `${brand.spacing.length} spacing tokens`,
    `${brand.buttons.length} button styles`,
    `${brand.cards.length} card styles`,
  ];
  return (
    <Section id="overview" title="Overview">
      <textarea
        className={`ui-input ${styles.summary}`}
        aria-label="Brand summary"
        value={brand.summary}
        onChange={(e) => update((d) => void (d.summary = e.target.value))}
      />
      <div className={styles.chips}>
        {chips.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>

      {conflicts.map((c) => (
        <div key={c.id} className={`${styles.notice} ${c.reviewed ? styles.done : styles.warn}`}>
          <strong>{c.reviewed ? "Decided" : "Needs a decision"}</strong>
          <p>{c.message}</p>
          <div className={styles.options}>
            {c.options.map((o) => (
              <button
                key={o.value}
                className={`ui-button ui-button--small ${c.resolved === o.value ? styles.optionOn : ""}`}
                onClick={() => resolve(c.id, o.value)}
                aria-pressed={c.resolved === o.value}
              >
                {c.resolved === o.value ? "✓ " : ""}
                <span style={{ fontFamily: c.field.startsWith("fonts.") ? family(o.value) : undefined }}>{o.value}</span>
                <span className={styles.share}>{Math.round(o.share * 100)}%</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      {brand.warnings.map((w) => (
        <div key={w} className={`${styles.notice} ${styles.bad}`}>
          {w}
        </div>
      ))}

      <div className={styles.contrast}>
        <h3>Contrast</h3>
        {failing.length ? (
          <p className={styles.bad}>
            {failing.length} pair{failing.length === 1 ? "" : "s"} only pass{failing.length === 1 ? "es" : ""} for large text or fail. Fix them before generating pages.
          </p>
        ) : (
          <p>Every text pair the components use passes WCAG AA.</p>
        )}
        <ul>
          {contrast.map((c) => (
            <li key={c.subject}>
              <span className={styles.pair} style={{ color: c.foreground, background: c.background }}>
                Aa
              </span>
              <span>{c.subject}</span>
              <span className={styles[`level${c.level.replace("-", "")}`]}>
                {c.ratio}:1 {c.level === "fail" ? "Fail" : c.level}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

// --- Colour -----------------------------------------------------------------------------------

function Colors({ brand, update }: { brand: Brand; update: Update }) {
  const add = () =>
    update((d) => {
      let n = 1;
      while (d.colors.some((c) => c.name === `custom-${n}`)) n++;
      d.colors.push({ name: `custom-${n}`, value: "#888888", role: "neutral", usage: ["added by hand"], sources: [], confidence: 1 });
    });
  return (
    <Section
      id="color"
      title="Colour"
      intro="Grouped by the role each colour plays. Names become CSS variables (--color-name)."
      action={
        <button className="ui-button ui-button--small" onClick={add}>
          + Add
        </button>
      }
    >
      {ROLE_GROUPS.map(([label, roles]) => {
        const list = brand.colors.map((c, i) => ({ c, i })).filter(({ c }) => roles.includes(c.role));
        if (!list.length) return null;
        return (
          <div key={label} className={styles.group}>
            <h3>{label}</h3>
            <div className={styles.swatches}>
              {list.map(({ c, i }) => (
                <div key={i} className={styles.swatch}>
                  <div className={styles.chip} style={{ background: c.value }}>
                    <span className={styles.role}>{c.role}</span>
                  </div>
                  <div className={styles.swatchBody}>
                    <input
                      className={styles.nameInput}
                      value={c.name}
                      aria-label="Token name"
                      onChange={(e) => update((d) => void (d.colors[i]!.name = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-")))}
                    />
                    <ColorField value={c.value} onChange={(v) => update((d) => Object.assign(d, replaceColor(d, d.colors[i]!.value, v)))} />
                    <p className={styles.usage}>{c.usage.join(", ") || "No usage recorded"}</p>
                    <div className={styles.meta}>
                      <Confidence value={c.confidence} sources={c.sources} />
                      {c.sources.length === 0 || c.usage.includes("added by hand") ? (
                        <button className={styles.remove} onClick={() => update((d) => void d.colors.splice(i, 1))}>
                          Remove
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </Section>
  );
}

// --- Typography -----------------------------------------------------------------------------------

const typeStyle = (t: TypeToken, max = 64): CSSProperties => ({
  fontFamily: family(t.fontFamily),
  fontSize: Math.min(t.fontSize, max),
  fontWeight: t.fontWeight,
  lineHeight: `${Math.min(t.lineHeight, max * 1.2)}px`,
  letterSpacing: t.letterSpacing,
  textTransform: t.textTransform,
});

const SAMPLE: Record<TypeToken["role"], string> = {
  display: "Big ideas, said simply",
  h1: "Ship your first workflow today",
  h2: "Built for teams that move fast",
  h3: "Connect your tools",
  h4: "Role-based access",
  body: "The quick brown fox jumps over the lazy dog, then checks the pipeline.",
  small: "Eyebrow label",
  label: "Book a demo",
};

function Typography({ brand, update }: { brand: Brand; update: Update }) {
  const setFamily = (key: "heading" | "body", value: string) =>
    update((d) => {
      const previous = d.fonts[key];
      d.fonts[key] = value;
      for (const t of d.typography) if (t.fontFamily === previous) t.fontFamily = value;
    });
  return (
    <Section id="type" title="Typography" intro="Sizes are desktop; mobile sizes were measured at 390px wide.">
      <div className={styles.fonts}>
        <div className={styles.fontCard}>
          <span className="ui-label">Headings</span>
          <p style={{ fontFamily: family(brand.fonts.heading), fontSize: 28, fontWeight: 600 }}>{brand.fonts.heading}</p>
          <TextField label="Font family" value={brand.fonts.heading} onChange={(v) => setFamily("heading", v)} />
        </div>
        <div className={styles.fontCard}>
          <span className="ui-label">Body</span>
          <p style={{ fontFamily: family(brand.fonts.body), fontSize: 28 }}>{brand.fonts.body}</p>
          <TextField label="Font family" value={brand.fonts.body} onChange={(v) => setFamily("body", v)} />
        </div>
      </div>
      <div className={styles.typeList}>
        {brand.typography.map((t, i) => {
          const set = (fn: (t: TypeToken) => void) => update((d) => fn(d.typography[i]!));
          return (
            <div key={t.role} className={styles.typeRow}>
              <div className={styles.typeHead}>
                <strong>{t.role}</strong>
                <span>{t.fontFamily}</span>
                <Confidence value={t.confidence} sources={t.sources} />
              </div>
              <p className={styles.typeSample} style={typeStyle(t)}>
                {SAMPLE[t.role]}
              </p>
              <div className={styles.typeFields}>
                <NumberField label="Size" value={t.fontSize} onChange={(v) => set((x) => void (x.fontSize = v))} />
                <NumberField label="Mobile" value={t.mobileFontSize ?? t.fontSize} onChange={(v) => set((x) => void (x.mobileFontSize = v))} />
                <WeightField value={t.fontWeight} onChange={(v) => set((x) => void (x.fontWeight = v))} />
                <NumberField label="Line height" value={t.lineHeight} onChange={(v) => set((x) => void (x.lineHeight = v))} />
                <NumberField label="Letter spacing" value={t.letterSpacing} step={0.1} onChange={(v) => set((x) => void (x.letterSpacing = v))} />
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// --- Logo -----------------------------------------------------------------------------------------

function LogoMark({ brand }: { brand: Brand }) {
  const logo = brand.logo!;
  if (logo.kind === "svg" && logo.svg) {
    return (
      <span className={styles.logoMark}>
        {/* Sanitised at extraction time: scripts, event handlers and external links removed. */}
        <span dangerouslySetInnerHTML={{ __html: logo.svg }} />
        {logo.text ? <span>{logo.text}</span> : null}
      </span>
    );
  }
  if (logo.kind === "img" && logo.src) return <img className={styles.logoImg} src={logo.src} alt={`${brand.name} logo`} />;
  return <span className={styles.logoMark}>{logo.text}</span>;
}

function LogoSection({ brand }: { brand: Brand }) {
  const brandColor = brand.colors.find((c) => c.role === "brand")?.value ?? "#111";
  const surface = brand.colors.find((c) => c.role === "surface")?.value ?? "#fff";
  const ink = brand.colors.find((c) => c.role === "ink")?.value ?? "#111";
  return (
    <Section id="logo" title="Logo" intro="Taken from the site header.">
      {brand.logo && /fill="(#fff(fff)?|white)"/i.test(brand.logo.svg ?? "") ? (
        <div className={`${styles.notice} ${styles.warn}`}>
          Part of this logo is white, so it disappears on light backgrounds. Add a dark version before using it on light sections.
        </div>
      ) : null}
      {brand.logo ? (
        <div className={styles.logos}>
          <div style={{ background: brandColor, color: "#fff" }}>
            <LogoMark brand={brand} />
          </div>
          <div style={{ background: surface, color: ink }}>
            <LogoMark brand={brand} />
          </div>
        </div>
      ) : (
        <div className={`${styles.notice} ${styles.bad}`}>We couldn't find a logo in the site header. Add it manually or skip for now.</div>
      )}
    </Section>
  );
}

// --- UI elements --------------------------------------------------------------------------------------

function ButtonPreview({ b }: { b: ButtonStyle }) {
  return (
    <span
      className={styles.buttonPreview}
      style={{
        background: b.background ?? "transparent",
        color: b.color,
        border: b.borderColor ? `${b.borderWidth || 1}px solid ${b.borderColor}` : "0",
        borderRadius: b.radius >= 9999 ? 999 : b.radius,
        padding: b.kind === "text" ? 0 : `${b.paddingY}px ${b.paddingX}px`,
        fontSize: b.fontSize,
        fontWeight: b.fontWeight,
        textTransform: b.textTransform,
        textDecoration: b.kind === "text" ? "underline" : undefined,
      }}
    >
      {b.sampleText || b.name}
    </span>
  );
}

function UiElements({ brand, update }: { brand: Brand; update: Update }) {
  const rules = brand.usageRules.find((r) => r.startsWith("Buttons use"));
  return (
    <Section id="ui" title="UI elements">
      <h3 className={styles.sub}>Buttons</h3>
      {rules ? <p className={styles.subIntro}>{rules}</p> : null}
      <div className={styles.tiles}>
        {brand.buttons.map((b, i) => {
          const set = (fn: (x: ButtonStyle) => void) => update((d) => fn(d.buttons[i]!));
          return (
            <div key={b.name} className={styles.tile}>
              <div className={styles.stage} style={{ background: b.context }}>
                <ButtonPreview b={b} />
              </div>
              <div className={styles.tileBody}>
                <div className={styles.tileHead}>
                  <strong>{b.name}</strong>
                  <span>{b.kind}</span>
                  <Confidence value={b.confidence} sources={b.sources} />
                </div>
                <ColorField label="Text" value={b.color} onChange={(v) => set((x) => void (x.color = v))} />
                {b.kind === "filled" ? <ColorField label="Background" value={b.background} onChange={(v) => set((x) => void (x.background = v))} /> : null}
                {b.kind === "outline" ? <ColorField label="Border" value={b.borderColor} onChange={(v) => set((x) => void (x.borderColor = v))} /> : null}
                {b.kind !== "text" ? (
                  <NumberField label="Corner radius" value={b.radius >= 9999 ? 999 : b.radius} min={0} onChange={(v) => set((x) => void (x.radius = v))} />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <h3 className={styles.sub}>Cards</h3>
      <div className={styles.tiles}>
        {brand.cards.map((c, i) => (
          <div key={c.name} className={styles.tile}>
            <div className={styles.stage} style={{ background: c.context }}>
              <div
                className={styles.cardPreview}
                style={{
                  background: c.background,
                  border: c.borderColor ? `${c.borderWidth}px solid ${c.borderColor}` : "0",
                  borderRadius: c.radius,
                  boxShadow: c.shadow ?? "none",
                  padding: Math.min(c.padding, 28),
                  fontFamily: family(brand.fonts.body),
                }}
              >
                <strong style={{ fontFamily: family(brand.fonts.heading) }}>{c.name} card</strong>
                <span>Features, proof points, pricing.</span>
              </div>
            </div>
            <div className={styles.tileBody}>
              <div className={styles.tileHead}>
                <strong>{c.name}</strong>
                <Confidence value={c.confidence} sources={c.sources} />
              </div>
              <ColorField label="Background" value={c.background} onChange={(v) => update((d) => void (d.cards[i]!.background = v))} />
              <ColorField label="Border" value={c.borderColor} onChange={(v) => update((d) => void (d.cards[i]!.borderColor = v))} />
              <div className={styles.pairFields}>
                <NumberField label="Radius" value={c.radius} min={0} onChange={(v) => update((d) => void (d.cards[i]!.radius = v))} />
                <NumberField label="Padding" value={c.padding} min={0} onChange={(v) => update((d) => void (d.cards[i]!.padding = v))} />
              </div>
            </div>
          </div>
        ))}
        {!brand.cards.length ? <p className={styles.subIntro}>No card styles were found.</p> : null}
      </div>

      {brand.input ? (
        <>
          <h3 className={styles.sub}>Form fields</h3>
          <div className={styles.inputPreview}>
            <input
              readOnly
              placeholder="you@company.com"
              style={{
                background: brand.input.background,
                color: brand.input.color,
                border: brand.input.borderColor ? `${brand.input.borderWidth}px solid ${brand.input.borderColor}` : "0",
                borderRadius: brand.input.radius,
                padding: `${brand.input.paddingY}px ${brand.input.paddingX}px`,
                fontSize: brand.input.fontSize,
                fontFamily: family(brand.fonts.body),
              }}
            />
            <Confidence value={brand.input.confidence} sources={brand.input.sources} />
          </div>
        </>
      ) : null}
    </Section>
  );
}

// --- Radius and spacing ------------------------------------------------------------------------------

function Radius({ brand, update }: { brand: Brand; update: Update }) {
  return (
    <Section id="radius" title="Radius" intro="Collected from buttons, cards and form fields.">
      <div className={styles.radii}>
        {brand.radii.map((r, i) => (
          <div key={r.name} className={styles.radius}>
            <div className={styles.radiusShape} style={{ borderTopLeftRadius: Math.min(r.value, 60) }} />
            <div className={styles.tileHead}>
              <strong>{r.name}</strong>
              <Confidence value={r.confidence} sources={r.sources} />
            </div>
            {r.value >= 9999 ? (
              <span className={styles.subIntro}>Pill</span>
            ) : (
              <NumberField label="Value" value={r.value} min={0} onChange={(v) => update((d) => void (d.radii[i]!.value = v))} />
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

function Spacing({ brand, update }: { brand: Brand; update: Update }) {
  const max = Math.max(...brand.spacing.map((s) => s.value), 1);
  return (
    <Section id="spacing" title="Spacing" intro="The most repeated paddings and gaps, smallest to largest.">
      <div className={styles.spacing}>
        {brand.spacing.map((s, i) => (
          <div key={s.name} className={styles.space}>
            <strong>{s.name}</strong>
            <div className={styles.spaceTrack}>
              <div className={styles.spaceBar} style={{ width: `${(s.value / max) * 100}%` }} />
            </div>
            <NumberField label="" value={s.value} min={0} onChange={(v) => update((d) => void (d.spacing[i]!.value = v))} />
          </div>
        ))}
      </div>
    </Section>
  );
}

// --- Usage rules ------------------------------------------------------------------------------------

function Rules({ brand, update }: { brand: Brand; update: Update }) {
  return (
    <Section
      id="rules"
      title="Usage rules"
      intro="Written from what we measured. Agents follow these when generating pages, so add anything the CSS can't show."
      action={
        <button className="ui-button ui-button--small" onClick={() => update((d) => void d.usageRules.push(""))}>
          + Add rule
        </button>
      }
    >
      <ol className={styles.rules}>
        {brand.usageRules.map((r, i) => (
          <li key={i}>
            <textarea
              className="ui-input"
              rows={2}
              value={r}
              placeholder="e.g. Never place lime text on white."
              onChange={(e) => update((d) => void (d.usageRules[i] = e.target.value))}
            />
            <button className={styles.remove} onClick={() => update((d) => void d.usageRules.splice(i, 1))} aria-label="Remove rule">
              Remove
            </button>
          </li>
        ))}
      </ol>
    </Section>
  );
}
