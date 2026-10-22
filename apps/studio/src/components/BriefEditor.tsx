import { useEffect, useRef, useState, type ReactNode } from "react";
import type { BriefIssue } from "@lph/brief/check";
import {
  CHANNELS,
  FUNNEL_STAGES,
  PROOF_SOURCES,
  SCHEMA_TYPES,
  SEARCH_INTENTS,
  SECTIONS as SECTION_TYPES,
  type Brief,
  type Channel,
  type OutlineSection,
  type ProofPoint,
  type SectionType,
} from "@lph/brief/schema";
import { SelectField, TextAreaField, TextField } from "./Fields.tsx";
import { ListEditor, StringList } from "./ListEditor.tsx";
import styles from "./BriefEditor.module.scss";

type Update = (fn: (draft: Brief) => void) => void;

const SECTIONS = [
  ["objective", "Objective & KPI"],
  ["personas", "Personas"],
  ["funnel", "Funnel & channels"],
  ["messages", "Key messages"],
  ["offer", "Offer & CTA"],
  ["proof", "Proof points"],
  ["outline", "Page outline"],
  ["seo", "SEO & AEO"],
  ["assumptions", "Assumptions"],
] as const;

const STAGE_HELP: Record<(typeof FUNNEL_STAGES)[number], string> = {
  awareness: "They don't know you yet. Teach, don't sell.",
  consideration: "They're comparing approaches. Show how it works.",
  decision: "They're choosing a vendor. Remove the last doubts.",
  retention: "They're already customers. Help them get more out of it.",
};

const CHANNEL_NAMES: Record<Channel, string> = {
  "organic-search": "Organic search",
  "answer-engines": "Answer engines (ChatGPT, Perplexity, AI Overviews)",
  email: "Email",
  "organic-social": "Organic social",
  partners: "Partners",
  events: "Events and webinars",
  "sales-outreach": "Sales outreach",
  community: "Community",
  "in-product": "In-product",
};

const SECTION_NAMES: Record<SectionType, string> = {
  hero: "Hero",
  logos: "Logo row",
  features: "Features",
  steps: "How it works",
  stats: "Stats",
  testimonial: "Testimonial",
  comparison: "Comparison",
  faq: "FAQ",
  form: "Lead form",
  cta: "Closing CTA",
};

const slugId = (name: string, taken: string[]) => {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "persona";
  let id = base;
  for (let i = 2; taken.includes(id); i++) id = `${base}-${i}`;
  return id;
};

export function BriefEditor({ brief, issues, update }: { brief: Brief; issues: BriefIssue[]; update: Update }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string>("objective");

  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id.replace("brief-", ""));
      },
      { root, rootMargin: "0px 0px -70% 0px" },
    );
    root.querySelectorAll("section[id^=brief-]").forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, []);

  const jump = (id: string) => {
    const root = scroller.current;
    const el = root?.querySelector<HTMLElement>(`#brief-${id}`);
    if (root && el) root.scrollTo({ top: el.offsetTop - 8, behavior: "smooth" });
    setActive(id);
  };

  const count = (id: string) => issues.filter((i) => i.section === id || (id === "funnel" && i.section === "channels")).filter((i) => i.severity !== "info").length;

  return (
    <div className={styles.layout}>
      <nav className={styles.nav} aria-label="Brief sections">
        {SECTIONS.map(([id, label]) => (
          <button key={id} className={active === id ? styles.navOn : undefined} onClick={() => jump(id)}>
            {label}
            {count(id) ? <span className={styles.navCount}>{count(id)}</span> : null}
          </button>
        ))}
      </nav>

      <div className={styles.content} ref={scroller}>
        <Section id="objective" title="Objective & KPI" intro="What the page is for, and how you'll know it worked.">
          <TextAreaField label="Objective" value={brief.objective.statement} onChange={(v) => update((d) => void (d.objective.statement = v))} rows={2} />
          <div className={styles.row3}>
            <TextField label="KPI" value={brief.objective.kpi.metric} onChange={(v) => update((d) => void (d.objective.kpi.metric = v))} />
            <TextField label="Target" value={brief.objective.kpi.target} onChange={(v) => update((d) => void (d.objective.kpi.target = v))} />
            <TextField label="Timeframe" value={brief.objective.kpi.timeframe} onChange={(v) => update((d) => void (d.objective.kpi.timeframe = v))} />
          </div>
          <TextAreaField label="Summary for stakeholders" value={brief.summary} onChange={(v) => update((d) => void (d.summary = v))} rows={3} />
        </Section>

        <Section id="personas" title="Personas" intro="Each persona gets its own page variant and URL when the page is built.">
          <ListEditor
            items={brief.personas}
            onChange={(next) => update((d) => void (d.personas = next))}
            label={(i) => `Persona ${i + 1}`}
            addLabel="Add persona"
            min={1}
            create={() => ({
              id: slugId("new persona", brief.personas.map((p) => p.id)),
              name: "New persona",
              role: "",
              context: "",
              pains: [""],
              motivations: [""],
              objections: [""],
            })}
            render={(p, set) => (
              <>
                <div className={styles.row2}>
                  <TextField label="Segment" value={p.name} onChange={(v) => set({ ...p, name: v })} />
                  <TextField label="Role" value={p.role} onChange={(v) => set({ ...p, role: v })} />
                </div>
                <TextAreaField label="Context" value={p.context} onChange={(v) => set({ ...p, context: v })} rows={2} />
                <div className={styles.row3}>
                  <StringList label="Pains" items={p.pains} onChange={(v) => set({ ...p, pains: v })} />
                  <StringList label="Motivations" items={p.motivations} onChange={(v) => set({ ...p, motivations: v })} />
                  <StringList label="Objections" items={p.objections} onChange={(v) => set({ ...p, objections: v })} />
                </div>
                <span className={styles.variantUrl}>
                  Variant URL: <code>/{brief.seo.slug}/{p.id}</code>
                </span>
              </>
            )}
          />
        </Section>

        <Section id="funnel" title="Funnel & channels" intro="Where the reader is in their journey sets how hard the page can ask. Paid ads are out of scope for now.">
          <div className={styles.stages} role="radiogroup" aria-label="Funnel stage">
            {FUNNEL_STAGES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={brief.funnelStage === s}
                className={brief.funnelStage === s ? styles.stageOn : undefined}
                onClick={() => update((d) => void (d.funnelStage = s))}
              >
                <strong>{s.charAt(0).toUpperCase() + s.slice(1)}</strong>
                <span>{STAGE_HELP[s]}</span>
              </button>
            ))}
          </div>
          <h3 className={styles.sub}>Channels</h3>
          <div className={styles.channels}>
            {CHANNELS.map((ch) => {
              const entry = brief.channels.find((c) => c.channel === ch);
              return (
                <div key={ch} className={`${styles.channel} ${entry ? styles.channelOn : ""}`}>
                  <label>
                    <input
                      type="checkbox"
                      checked={!!entry}
                      onChange={(e) =>
                        update((d) => {
                          d.channels = e.target.checked ? [...d.channels, { channel: ch, role: "" }] : d.channels.filter((c) => c.channel !== ch);
                        })
                      }
                    />
                    {CHANNEL_NAMES[ch]}
                  </label>
                  {entry ? (
                    <input
                      className="ui-input"
                      placeholder="What this channel does for the page"
                      aria-label={`${CHANNEL_NAMES[ch]} role`}
                      value={entry.role}
                      onChange={(e) => update((d) => void (d.channels.find((c) => c.channel === ch)!.role = e.target.value))}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </Section>

        <Section id="messages" title="Key messages" intro="In order of importance. Numbers must come from your site or your request.">
          <ListEditor
            items={brief.keyMessages}
            onChange={(next) => update((d) => void (d.keyMessages = next))}
            label={(i) => `Message ${i + 1}`}
            addLabel="Add message"
            create={() => ({ message: "", support: "" })}
            render={(m, set) => (
              <>
                <TextField label="Message" value={m.message} onChange={(v) => set({ ...m, message: v })} />
                <TextAreaField label="Support" value={m.support} onChange={(v) => set({ ...m, support: v })} rows={2} />
              </>
            )}
          />
        </Section>

        <Section id="offer" title="Offer & CTA">
          <TextAreaField label="Offer" value={brief.offer.offer} onChange={(v) => update((d) => void (d.offer.offer = v))} rows={2} />
          <div className={styles.row2}>
            <TextField label="Primary CTA" value={brief.offer.primaryCta} onChange={(v) => update((d) => void (d.offer.primaryCta = v))} />
            <TextField label="Secondary CTA (optional)" value={brief.offer.secondaryCta} onChange={(v) => update((d) => void (d.offer.secondaryCta = v))} />
          </div>
        </Section>

        <Section id="proof" title="Proof points" intro="Anything marked “Needs evidence” has to be sourced or removed before the page is published.">
          <ListEditor
            items={brief.proofPoints}
            onChange={(next) => update((d) => void (d.proofPoints = next))}
            label={(i) => `Proof point ${i + 1}`}
            addLabel="Add proof point"
            create={(): ProofPoint => ({ claim: "", source: "needed", evidence: "" })}
            render={(p, set) => (
              <>
                <div className={styles.rowWide}>
                  <TextField label="Claim" value={p.claim} onChange={(v) => set({ ...p, claim: v })} />
                  <SelectField
                    label="Source"
                    value={p.source}
                    options={PROOF_SOURCES.map((s) => [s, s === "site" ? "Your site" : s === "prompt" ? "Your request" : "Needs evidence"] as [typeof s, string])}
                    onChange={(v) => set({ ...p, source: v })}
                  />
                </div>
                <TextAreaField label={p.source === "needed" ? "What would back it" : "Evidence (exact text)"} value={p.evidence} onChange={(v) => set({ ...p, evidence: v })} rows={2} />
              </>
            )}
          />
        </Section>

        <Section id="outline" title="Page outline" intro="Built from the component library, so every section here can be generated in the next step.">
          <ListEditor
            items={brief.outline}
            onChange={(next) => update((d) => void (d.outline = next))}
            label={(i) => `Section ${i + 1}`}
            addLabel="Add section"
            create={(): OutlineSection => ({ type: "features", heading: "", purpose: SECTION_TYPES.features, notes: "" })}
            render={(s, set) => (
              <>
                <div className={styles.rowNarrow}>
                  <SelectField
                    label="Block"
                    value={s.type}
                    options={(Object.keys(SECTION_TYPES) as SectionType[]).map((t) => [t, SECTION_NAMES[t]] as [SectionType, string])}
                    onChange={(v) => set({ ...s, type: v })}
                  />
                  <TextField label={s.type === "hero" ? "Heading (the page's H1)" : "Heading"} value={s.heading} onChange={(v) => set({ ...s, heading: v })} />
                </div>
                <TextField label="Purpose" value={s.purpose} onChange={(v) => set({ ...s, purpose: v })} />
                <TextAreaField label="Notes for the writer" value={s.notes} onChange={(v) => set({ ...s, notes: v })} rows={2} />
              </>
            )}
          />
        </Section>

        <Section id="seo" title="SEO & AEO" intro={<SeoSource brief={brief} />}>
          <div className={styles.rowWide}>
            <TextField label="Primary keyword" value={brief.seo.primaryKeyword} onChange={(v) => update((d) => void (d.seo.primaryKeyword = v))} />
            <SelectField label="Search intent" value={brief.seo.searchIntent} options={SEARCH_INTENTS} onChange={(v) => update((d) => void (d.seo.searchIntent = v))} />
          </div>
          <StringList label="Secondary keywords" items={brief.seo.secondaryKeywords} onChange={(v) => update((d) => void (d.seo.secondaryKeywords = v))} />
          <TextField label="Title tag" value={brief.seo.title} range={[30, 60]} onChange={(v) => update((d) => void (d.seo.title = v))} />
          <TextAreaField label="Meta description" value={brief.seo.metaDescription} range={[120, 160]} rows={2} onChange={(v) => update((d) => void (d.seo.metaDescription = v))} />
          <TextField label="Slug" prefix="/" value={brief.seo.slug} onChange={(v) => update((d) => void (d.seo.slug = v))} />
          <div>
            <span className="ui-label">Structured data</span>
            <div className={styles.checks}>
              {SCHEMA_TYPES.map((t) => (
                <label key={t}>
                  <input
                    type="checkbox"
                    checked={brief.seo.schemaTypes.includes(t)}
                    onChange={(e) => update((d) => void (d.seo.schemaTypes = e.target.checked ? [...d.seo.schemaTypes, t] : d.seo.schemaTypes.filter((x) => x !== t)))}
                  />
                  {t}
                </label>
              ))}
            </div>
          </div>
          <h3 className={styles.sub}>Questions to answer</h3>
          <p className={styles.subIntro}>Answer engines quote direct answers. Aim for 40 to 60 words each.</p>
          <ListEditor
            items={brief.seo.questions}
            onChange={(next) => update((d) => void (d.seo.questions = next))}
            label={(i) => `Question ${i + 1}`}
            addLabel="Add question"
            create={() => ({ question: "", answer: "" })}
            render={(q, set) => (
              <>
                <TextField label="Question" value={q.question} onChange={(v) => set({ ...q, question: v })} />
                <TextAreaField label={`Answer (${q.answer.trim() ? q.answer.trim().split(/\s+/).length : 0} words)`} value={q.answer} onChange={(v) => set({ ...q, answer: v })} rows={3} />
              </>
            )}
          />
        </Section>

        <Section id="assumptions" title="Assumptions" intro="What the brief assumed. Confirm or correct each one.">
          <StringList label="Assumptions" items={brief.assumptions} onChange={(v) => update((d) => void (d.assumptions = v))} />
        </Section>
      </div>

      <Checks issues={issues} jump={jump} />
    </div>
  );
}

function Section({ id, title, intro, children }: { id: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section id={`brief-${id}`} className={styles.section}>
      <div className={styles.sectionHead}>
        <h2>{title}</h2>
        {intro ? <div className={styles.intro}>{intro}</div> : null}
      </div>
      <div className={styles.fields}>{children}</div>
    </section>
  );
}

function SeoSource({ brief }: { brief: Brief }) {
  const { insights } = brief;
  const connected = insights.provider !== "best-practices";
  return (
    <>
      {connected ? `Keyword data from your SEO tool (${insights.keywords.length} keywords).` : "No SEO tool connected: keywords follow best practices and need validating."}
      {insights.notes.length ? <span className={styles.seoNotes}>{insights.notes.join(" ")}</span> : null}
      {insights.keywords.some((k) => k.volume != null) ? (
        <table className={styles.keywords}>
          <thead>
            <tr>
              <th>Keyword</th>
              <th>Volume</th>
              <th>Difficulty</th>
            </tr>
          </thead>
          <tbody>
            {insights.keywords.slice(0, 8).map((k) => (
              <tr key={k.term}>
                <td>{k.term}</td>
                <td>{k.volume ?? "–"}</td>
                <td>{k.difficulty ?? "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}

const SEVERITY: [BriefIssue["severity"], string][] = [
  ["error", "Must fix"],
  ["warning", "Fix before publishing"],
  ["info", "Worth a look"],
];

function Checks({ issues, jump }: { issues: BriefIssue[]; jump: (section: string) => void }) {
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  return (
    <aside className={styles.checksPanel} aria-label="Brief checks">
      <div className={`${styles.verdict} ${errors ? styles.verdictBad : warnings ? styles.verdictWarn : styles.verdictOk}`}>
        <strong>{errors ? `${errors} to fix before building` : warnings ? `Ready to build, ${warnings} to fix before publishing` : "Ready to build and publish"}</strong>
        <span>Checked against your site, the funnel stage and search best practice.</span>
      </div>
      {SEVERITY.map(([sev, title]) => {
        const list = issues.filter((i) => i.severity === sev);
        if (!list.length) return null;
        return (
          <div key={sev} className={styles.checkGroup}>
            <h3>
              {title} <span>{list.length}</span>
            </h3>
            <ul>
              {list.map((i) => (
                <li key={i.id}>
                  <button type="button" className={styles[`issue-${sev}`]} onClick={() => jump(i.section === "channels" ? "funnel" : i.section)}>
                    {i.message}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </aside>
  );
}
