/** @jsxRuntime automatic */
import type { ReactNode } from "react";

/**
 * Section bodies for landing pages. Each goes inside a <Section>, which supplies the
 * band, the heading and the spacing; these only lay out the content.
 */

/** A customer logo as the site shows it. The SVG was sanitised when it was imported. */
export interface LogoMark {
  name: string;
  svg?: string;
  src?: string;
}

/** Names match a logo whatever their case and punctuation: "Monday.com" is "monday.com". */
export const logoKey = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** Customer names, each shown as its logo when there is one, as text otherwise. */
export function LogoRow({ items, logos = [] }: { items: string[]; logos?: LogoMark[] }) {
  const byName = new Map(logos.map((l) => [logoKey(l.name), l]));
  return (
    <ul className="lph-logos" aria-label="Customers">
      {items.map((name, i) => {
        const logo = byName.get(logoKey(name));
        return (
          <li key={i}>
            {logo?.svg ? (
              <span className="lph-logos__mark" role="img" aria-label={name} dangerouslySetInnerHTML={{ __html: logo.svg }} />
            ) : logo?.src ? (
              <img className="lph-logos__mark" src={logo.src} alt={name} loading="lazy" decoding="async" />
            ) : (
              name
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function Steps({ items }: { items: { title: ReactNode; body: ReactNode }[] }) {
  return (
    <ol className="lph-steps">
      {items.map((s, i) => (
        <li key={i}>
          <h3 className="lph-h4">{s.title}</h3>
          <p className="lph-body lph-muted">{s.body}</p>
        </li>
      ))}
    </ol>
  );
}

export function Stats({ items }: { items: { value: ReactNode; label: ReactNode }[] }) {
  return (
    <dl className="lph-stats">
      {items.map((s, i) => (
        <div key={i}>
          <dt>{s.label}</dt>
          <dd>{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Quote({ quote, name, role, company }: { quote: ReactNode; name: ReactNode; role?: ReactNode; company?: ReactNode }) {
  const who = [role, company].filter(Boolean);
  return (
    <figure className="lph-quote">
      <blockquote>
        <p>{quote}</p>
      </blockquote>
      <figcaption>
        <cite>{name}</cite>
        {who.length ? <span>, {who.map((w, i) => (i ? [", ", w] : w))}</span> : null}
      </figcaption>
    </figure>
  );
}

export function Comparison({ caption, columns, rows }: { caption: string; columns: { ours: ReactNode; theirs: ReactNode }; rows: { label: ReactNode; ours: ReactNode; theirs: ReactNode }[] }) {
  return (
    // It scrolls sideways on a phone, so keyboard users need to be able to focus it.
    <div className="lph-table-wrap" tabIndex={0} role="region" aria-label={caption}>
      <table className="lph-table">
        <caption className="lph-visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <td />
            <th scope="col">{columns.ours}</th>
            <th scope="col">{columns.theirs}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <th scope="row">{r.label}</th>
              <td>{r.ours}</td>
              <td>{r.theirs}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Questions and answers. Answers stay in the markup when closed, so crawlers and answer engines read them. */
export function Faq({ items }: { items: { question: ReactNode; answer: ReactNode }[] }) {
  return (
    <div className="lph-faq">
      {items.map((q, i) => (
        <details key={i} open={i === 0}>
          <summary>{q.question}</summary>
          <p>{q.answer}</p>
        </details>
      ))}
    </div>
  );
}

/** Two columns: copy on one side (a heading and intro), something to act on on the other (a form). */
export function Split({ start, end }: { start: ReactNode; end: ReactNode }) {
  return (
    <div className="lph-split">
      <div>{start}</div>
      <div>{end}</div>
    </div>
  );
}
