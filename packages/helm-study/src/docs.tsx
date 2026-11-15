/** The docs page: each component's examples, props and tokens, generated from the stories. */
import type { PageAdoption } from "./adoption.ts";
import type { BuiltToken } from "./build-tokens.ts";
import { pageHtml } from "./render.tsx";
import { STORIES, STORY_CSS } from "./stories.tsx";
import type { TokenReport } from "./tokens.ts";

const PROPS: Record<string, [string, string, string][]> = {
  Button: [
    ["variant", '"primary" | "secondary"', "primary is the one main action in a view; secondary sits next to it. Default primary."],
    ["size", '"default" | "compact"', "compact tightens the vertical padding only, for navigation and dense rows."],
    ["href", "string", "Renders an <a>. Without it, a <button type=\"button\">."],
    ["arrow", "boolean", "The hover arrow. On by default for links, off for buttons."],
    ["disabled / aria-disabled", "boolean", "Disabled colours, no hover, not-allowed cursor."],
  ],
  Link: [
    ["variant", '"inline" | "callout"', "inline is underlined inside a sentence; callout stands alone with the hover arrow. Default inline."],
    ["href", "string", "Required."],
  ],
};

const GUIDANCE: Record<string, string[]> = {
  Button: [
    "Use one primary button per view. A second action next to it is secondary.",
    "Label with a verb and what happens: \"Start now\", \"Contact sales\". The arrow says the link goes somewhere; it isn't a substitute for the words.",
    "Use href for navigation and no href for actions on the page, so screen readers announce a link or a button correctly.",
  ],
  Link: ["Use callout for a standalone next step under a card or section, inline inside running text.", "Inline links stay underlined: colour alone doesn't mark a link for everyone."],
};

/** How many measured properties the parity test compares, at rest. */
const PARITY_CHECKS = STORIES.reduce((n, s) => n + (s.parity?.props.length ?? 0), 0);

const DOCS_CSS = `
${STORY_CSS}
.docs { max-width: 960px; margin: 0 auto; padding: 48px 24px 96px; color: var(--sl-page-text); line-height: 1.5; }
.docs h1 { font-size: 32px; font-weight: 500; margin: 0 0 8px; }
.docs h2 { font-size: 22px; font-weight: 500; margin: 56px 0 8px; }
.docs h3 { font-size: 16px; font-weight: 500; margin: 24px 0 8px; }
.docs p, .docs li { color: var(--sl-page-text-soft); max-width: 46em; }
.docs table { border-collapse: collapse; width: 100%; font-size: 14px; margin: 8px 0 16px; }
.docs th, .docs td { text-align: left; padding: 8px 12px 8px 0; border-bottom: 1px solid var(--sl-button-secondary-border); vertical-align: top; }
.docs code { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 13px; }
.docs .note { font-size: 14px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
.example { border: 1px solid var(--sl-button-secondary-border); border-radius: var(--sl-button-radius); overflow: hidden; }
.example .story { display: block; min-height: 96px; }
.example figcaption { padding: 8px 12px; font-size: 13px; color: var(--sl-page-text-soft); border-top: 1px solid var(--sl-button-secondary-border); }
.stat { font-size: 28px; font-weight: 500; color: var(--sl-page-text); }
.stats { display: flex; flex-wrap: wrap; gap: 32px; margin: 16px 0; }
.table-scroll { overflow-x: auto; }
.table-scroll:focus-visible { outline: 2px solid var(--sl-focus-ring); outline-offset: 2px; }
@media (max-width: 600px) { .docs { padding: 32px 16px 64px; } }
`;

export function docsHtml(opts: { tokens: BuiltToken[]; adoption: PageAdoption[]; report: TokenReport; takenAt: string }): string {
  const { tokens, adoption, report } = opts;
  const helmPages = adoption.filter((p) => p.system === "helm").length;
  const body = (
    <main className="docs">
      <h1>Helm study: Button and Link</h1>
      <p>
        An unofficial study of Helm, the design system behind stripe.com, built from what the public site serves. Not affiliated with Stripe. The components below are new code; their
        values come from Helm's token graph as read on {opts.takenAt.slice(0, 10)}, and tests check them against the live components. Inter stands in for Söhne, which is licensed.
      </p>
      <div className="stats">
        <div>
          <div className="stat">
            {helmPages} of {adoption.length}
          </div>
          main pages on Helm
        </div>
        <div>
          <div className="stat">{report.total}</div>
          tokens in three tiers
        </div>
        <div>
          <div className="stat">{report.modeAware}</div>
          change in dark mode
        </div>
        <div>
          <div className="stat">{PARITY_CHECKS}</div>
          properties checked against live Helm in CI
        </div>
      </div>

      {(["Button", "Link"] as const).map((name) => (
        <section key={name} aria-labelledby={`h-${name}`}>
          <h2 id={`h-${name}`}>{name}</h2>
          <ul>
            {GUIDANCE[name]!.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
          <h3>Examples</h3>
          <div className="grid">
            {STORIES.filter((s) => s.component === name).map((s) => (
              <figure key={s.id} className="example" style={{ margin: 0 }}>
                <div className={`story sl-mode-${s.mode}`}>{s.render()}</div>
                <figcaption>
                  {s.title}
                  {s.parity ? " · checked against live Helm" : ""}
                </figcaption>
              </figure>
            ))}
          </div>
          <h3>Props</h3>
          {/* Focusable, so keyboard users can scroll it on a phone. */}
          <div className="table-scroll" tabIndex={0} role="region" aria-label={`${name} props`}>
          <table>
            <thead>
              <tr>
                <th scope="col">Prop</th>
                <th scope="col">Type</th>
                <th scope="col">Notes</th>
              </tr>
            </thead>
            <tbody>
              {PROPS[name]!.map(([p, t, n]) => (
                <tr key={p}>
                  <td>
                    <code>{p}</code>
                  </td>
                  <td>
                    <code>{t}</code>
                  </td>
                  <td>{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </section>
      ))}

      <section aria-labelledby="h-tokens">
        <h2 id="h-tokens">Component tokens</h2>
        <p>Each one mirrors a Helm token and reaches its value through the same semantic layer, so dark mode only has to change the middle tier.</p>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Component token table">
        <table>
          <thead>
            <tr>
              <th scope="col">Token</th>
              <th scope="col">Mirrors</th>
              <th scope="col">Light</th>
              <th scope="col">Dark</th>
            </tr>
          </thead>
          <tbody>
            {tokens
              .filter((t) => t.tier === "component")
              .map((t) => (
                <tr key={t.name}>
                  <td>
                    <code>{t.name}</code>
                  </td>
                  <td>
                    <code>{t.helm}</code>
                  </td>
                  <td>
                    <code>{t.resolved.light}</code>
                  </td>
                  <td>
                    <code>{t.resolved.dark}</code>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        </div>
      </section>
    </main>
  );
  return pageHtml(body, { title: "Helm study: Button and Link", extraCss: DOCS_CSS });
}
