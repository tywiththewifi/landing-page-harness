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

export function Card({ variant = "default", title, children }: CardProps) {
  return (
    <div className={cx("lph-card", `lph-card--${variant}`)}>
      {title ? <h3 className="lph-h3">{title}</h3> : null}
      {children}
    </div>
  );
}

export interface HeroProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
  /** Optional right-hand column, e.g. a lead form. */
  aside?: ReactNode;
}

export function Hero({ eyebrow, title, lead, actions, aside }: HeroProps) {
  return (
    <section className={cx("lph-hero", aside && "lph-hero--split")}>
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
  tone?: "default" | "subtle" | "brand";
  eyebrow?: ReactNode;
  title?: ReactNode;
  intro?: ReactNode;
  children?: ReactNode;
}

export function Section({ tone = "default", eyebrow, title, intro, children }: SectionProps) {
  return (
    <section className={cx("lph-section", tone !== "default" && `lph-section--${tone}`)}>
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

export function Grid({ children }: { children: ReactNode }) {
  return <div className="lph-grid">{children}</div>;
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
  type?: "text" | "email" | "tel" | "textarea";
  placeholder?: string;
  required?: boolean;
}

export interface LeadFormProps {
  title?: ReactNode;
  fields: FormField[];
  submitLabel: string;
  /** Where submissions are posted (the forms webhook). */
  action?: string;
  variant?: string;
}

export function LeadForm({ title, fields, submitLabel, action, variant = "primary" }: LeadFormProps) {
  return (
    <div className="lph-card lph-card--default">
      {title ? <h3 className="lph-h3">{title}</h3> : null}
      <form className="lph-form" method="post" action={action}>
        {fields.map((f) => (
          <label className="lph-field" key={f.name}>
            <span className="lph-field__label">{f.label}</span>
            {f.type === "textarea" ? (
              <textarea className="lph-input" name={f.name} placeholder={f.placeholder} required={f.required} />
            ) : (
              <input className="lph-input" name={f.name} type={f.type ?? "text"} placeholder={f.placeholder} required={f.required} />
            )}
          </label>
        ))}
        <Button variant={variant} type="submit">
          {submitLabel}
        </Button>
      </form>
    </div>
  );
}
