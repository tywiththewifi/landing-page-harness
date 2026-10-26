/** @jsxRuntime automatic */
import type { ReactNode } from "react";

const cx = (...c: unknown[]) => c.filter(Boolean).join(" ");

export interface ButtonProps {
  /** A button variant from the brand, e.g. "primary", "secondary", "link". */
  variant?: string;
  href?: string;
  type?: "button" | "submit";
  children: ReactNode;
}

export function Button({ variant = "primary", href, type = "button", children }: ButtonProps) {
  const className = cx("lph-button", `lph-button--${variant}`);
  return href ? (
    <a className={className} href={href}>
      {children}
    </a>
  ) : (
    <button className={className} type={type}>
      {children}
    </button>
  );
}

export interface CardProps {
  variant?: string;
  title?: ReactNode;
  children?: ReactNode;
}

/** Without a variant (a brand with no measured card styles), the card is drawn from the colour and radius tokens alone. */
export function Card({ variant, title, children }: CardProps) {
  return (
    <div className={cx("lph-card", variant && `lph-card--${variant}`)}>
      {title ? <h3 className="lph-h3">{title}</h3> : null}
      {children}
    </div>
  );
}

export interface HeroProps {
  id?: string;
  eyebrow?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
  /** Optional right-hand column, e.g. a lead form. */
  aside?: ReactNode;
  /** The band behind it: the brand colour by default. */
  tone?: "brand" | "subtle";
}

export function Hero({ id, eyebrow, title, lead, actions, aside, tone = "brand" }: HeroProps) {
  return (
    <section id={id} className={cx("lph-hero", tone === "subtle" && "lph-hero--subtle", aside && "lph-hero--split")}>
      <div className="lph-container lph-hero__inner">
        <div>
          {eyebrow ? <span className="lph-eyebrow">{eyebrow}</span> : null}
          <h1 className="lph-h1">{title}</h1>
          {lead ? <p className="lph-lead">{lead}</p> : null}
          {actions ? <div className="lph-actions">{actions}</div> : null}
        </div>
        {aside ? <div>{aside}</div> : null}
      </div>
    </section>
  );
}

export interface SectionProps {
  /** Also the anchor buttons link to, e.g. "form" for #form. */
  id?: string;
  tone?: "default" | "subtle" | "brand";
  align?: "start" | "center";
  eyebrow?: ReactNode;
  title?: ReactNode;
  intro?: ReactNode;
  children?: ReactNode;
}

export function Section({ id, tone = "default", align = "start", eyebrow, title, intro, children }: SectionProps) {
  return (
    <section id={id} className={cx("lph-section", tone !== "default" && `lph-section--${tone}`, align === "center" && "lph-section--center")}>
      <div className="lph-container">
        {title || intro ? (
          <div className="lph-section__intro">
            {eyebrow ? <span className="lph-eyebrow">{eyebrow}</span> : null}
            {title ? <h2 className="lph-h2">{title}</h2> : null}
            {intro ? <p className="lph-body lph-muted">{intro}</p> : null}
          </div>
        ) : null}
        {children}
      </div>
    </section>
  );
}

/** Pass `count` so three or six cards fill even rows of three instead of leaving an orphan row. */
export function Grid({ children, count }: { children: ReactNode; count?: number }) {
  return <div className={count && count % 3 === 0 ? "lph-grid lph-grid--thirds" : "lph-grid"}>{children}</div>;
}

export interface NavProps {
  logo: ReactNode;
  links?: { label: string; href: string }[];
  cta?: ReactNode;
  /** "surface" for sites whose header sits on the page background rather than a brand band. */
  tone?: "brand" | "surface";
}

export function Nav({ logo, links = [], cta, tone = "brand" }: NavProps) {
  return (
    <header className={tone === "surface" ? "lph-nav lph-nav--surface" : "lph-nav"}>
      <div className="lph-container lph-nav__inner">
        <a className="lph-nav__logo" href="/">
          {logo}
        </a>
        <nav aria-label="Main">
          <ul className="lph-nav__links">
            {links.map((l) => (
              <li key={l.href}>
                <a href={l.href}>{l.label}</a>
              </li>
            ))}
          </ul>
        </nav>
        {cta}
      </div>
    </header>
  );
}

export function Footer({ children }: { children: ReactNode }) {
  return (
    <footer className="lph-footer">
      <div className="lph-container">{children}</div>
    </footer>
  );
}

export interface FormField {
  name: string;
  label: string;
  type?: "text" | "email" | "tel" | "url" | "textarea";
  placeholder?: string;
  required?: boolean;
  autocomplete?: string;
}

export interface LeadFormProps {
  title?: ReactNode;
  fields: FormField[];
  submitLabel: string;
  /** Where submissions are posted (the forms webhook). */
  action?: string;
  variant?: string;
  /** The brand's card style the form sits in. Without one, the card is drawn from the tokens. */
  card?: string;
  /** What the details are used for, under the button. */
  consent?: ReactNode;
  /** Shown in place of the form once a submission goes through (the page's form script swaps it in). */
  successMessage?: string;
  /** Adds a hidden field that only bots fill in. */
  honeypot?: string;
}

export function LeadForm({ title, fields, submitLabel, action, variant = "primary", card, consent, successMessage, honeypot }: LeadFormProps) {
  return (
    <div className={cx("lph-card", card && `lph-card--${card}`)}>
      {title ? <h3 className="lph-h3">{title}</h3> : null}
      <form className="lph-form" method="post" action={action} data-success={successMessage}>
        {fields.map((f) => (
          <label className="lph-field" key={f.name}>
            <span className="lph-field__label">
              {f.label}
              {f.required ? null : <span className="lph-field__optional"> (optional)</span>}
            </span>
            {f.type === "textarea" ? (
              <textarea className="lph-input" name={f.name} placeholder={f.placeholder} required={f.required} autoComplete={f.autocomplete} />
            ) : (
              <input className="lph-input" name={f.name} type={f.type ?? "text"} placeholder={f.placeholder} required={f.required} autoComplete={f.autocomplete} />
            )}
            <span className="lph-field__error" data-error-for={f.name} />
          </label>
        ))}
        {honeypot ? (
          <label className="lph-hp" aria-hidden="true">
            Leave this empty
            <input name={honeypot} tabIndex={-1} autoComplete="off" />
          </label>
        ) : null}
        <Button variant={variant} type="submit">
          {submitLabel}
        </Button>
        {consent ? <p className="lph-form__note">{consent}</p> : null}
        <p className="lph-form__status" role="status" aria-live="polite" />
      </form>
    </div>
  );
}
