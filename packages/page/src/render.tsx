/** @jsxRuntime automatic */
import { renderToStaticMarkup } from "react-dom/server";
import { FIELDS, HONEYPOT } from "@lph/forms";
import { toCss, type Brand } from "@lph/tokens";
import { Button, Card, Comparison, Faq, Footer, Grid, Hero, LeadForm, LogoRow, Logo, Nav, Quote, Section, Split, Stats, Steps } from "@lph/ui";
import { safeHref, written } from "./blocks.ts";
import { buttonsFor, heroTone, navTone } from "./brand.ts";
import { FORM_SCRIPT } from "./form-script.ts";
import type { Block, Link, Page, Variant } from "./schema.ts";
import { applyVariant, versionPath } from "./variants.ts";

export interface RenderOptions {
  /** The version to render, by id or slug. Null or unknown renders the general page. */
  variant?: string | null;
  /**
   * Where the form posts. Without one the form is a preview: it checks the fields and
   * shows the thank-you message, but sends nothing.
   */
  formAction?: string;
  /** The live site's origin, e.g. "https://www.example.com", for canonical and Open Graph URLs. */
  origin?: string;
  /** Asks search engines not to index the page. Every preview sets it. */
  noindex?: boolean;
}

/** Site-derived strings end up inside <style>; make sure they can't close it. */
const cssSafe = (css: string) => css.replace(/<\/(style)/gi, "<\\/$1").replace(/<!--/g, "");
/** JSON inside <script> can't contain "</script>" or "<!--". */
const scriptJson = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");

export const findVariant = (page: Pick<Page, "variants">, key: string | null | undefined): Variant | null =>
  key ? (page.variants.find((v) => v.id === key || v.slug === key) ?? null) : null;

function Actions({ links, brand, tone }: { links: Link[]; brand: Brand; tone: Block["tone"] | "hero" }) {
  const shown = links.filter((l) => l.label.trim());
  if (!shown.length) return null;
  const { primary, secondary } = buttonsFor(brand, tone);
  return (
    <>
      {shown.map((l, i) => (
        <Button key={i} variant={i ? secondary : primary} href={safeHref(l.href)}>
          {l.label}
        </Button>
      ))}
    </>
  );
}

function BlockView({ block, brand, formAction }: { block: Block; brand: Brand; formAction?: string }) {
  const { id, tone } = block;
  const opt = (s: string) => (s.trim() ? s : undefined);
  switch (block.type) {
    case "hero":
      return (
        <Hero
          id={id}
          eyebrow={opt(block.eyebrow)}
          title={block.heading}
          lead={opt(block.lead)}
          actions={<Actions links={[block.primaryCta, block.secondaryCta]} brand={brand} tone={heroTone(brand, tone)} />}
          tone={heroTone(brand, tone)}
        />
      );
    case "logos":
      return (
        <Section id={id} tone={tone} align="center" title={opt(block.heading)}>
          <LogoRow items={block.items.filter((s) => s.trim())} logos={brand.customers} />
        </Section>
      );
    case "features":
      return (
        <Section id={id} tone={tone} eyebrow={opt(block.eyebrow)} title={opt(block.heading)} intro={opt(block.intro)}>
          <Grid count={block.items.length}>
            {block.items.map((item, i) => (
              <Card key={i} variant={block.cardVariant} title={item.title}>
                <p className="lph-body lph-muted">{item.body}</p>
              </Card>
            ))}
          </Grid>
        </Section>
      );
    case "steps":
      return (
        <Section id={id} tone={tone} title={opt(block.heading)} intro={opt(block.intro)}>
          <Steps items={block.items} />
        </Section>
      );
    case "stats":
      return (
        <Section id={id} tone={tone} title={opt(block.heading)}>
          <Stats items={block.items} />
        </Section>
      );
    case "testimonial":
      return (
        <Section id={id} tone={tone}>
          <Quote quote={block.quote} name={block.name} role={opt(block.role)} company={opt(block.company)} />
        </Section>
      );
    case "comparison":
      return (
        <Section id={id} tone={tone} title={opt(block.heading)} intro={opt(block.intro)}>
          <Comparison caption={block.heading || "Comparison"} columns={block.columns} rows={block.rows} />
        </Section>
      );
    case "faq":
      return (
        <Section id={id} tone={tone} title={opt(block.heading)}>
          <Faq items={block.items.filter((q) => q.question.trim())} />
        </Section>
      );
    case "form":
      return (
        <Section id={id} tone={tone}>
          <Split
            start={
              <div className="lph-section__intro">
                {block.heading ? <h2 className="lph-h2">{block.heading}</h2> : null}
                {block.intro ? <p className="lph-body lph-muted">{block.intro}</p> : null}
              </div>
            }
            end={
              <LeadForm
                fields={block.fields.map((f) => ({ name: f.name, label: f.label, required: f.required, type: FIELDS[f.name].type, autocomplete: FIELDS[f.name].autocomplete }))}
                submitLabel={block.submitLabel}
                action={formAction}
                variant={buttonsFor(brand, "default").primary}
                card={brand.cards[0]?.name}
                consent={opt(block.consent)}
                successMessage={block.successMessage || "Thanks, we got it."}
                honeypot={HONEYPOT}
              />
            }
          />
        </Section>
      );
    case "cta":
      return (
        <Section id={id} tone={tone} align="center" title={opt(block.heading)} intro={opt(block.body)}>
          <div className="lph-actions">
            <Actions links={[block.primaryCta, block.secondaryCta]} brand={brand} tone={tone} />
          </div>
        </Section>
      );
  }
}

/** Structured data from what the page actually shows: the page, the company, and the FAQ when there is one. */
export function structuredData(page: Pick<Page, "lang">, brand: Brand, view: Pick<Page, "blocks" | "seo">, url?: string) {
  const faq = view.blocks.find((b) => b.type === "faq");
  const questions = faq?.type === "faq" ? faq.items.filter((q) => written(q.question) && written(q.answer)) : [];
  const org = { "@type": "Organization", "@id": `${brand.url}#organization`, name: brand.name, url: brand.url, ...(brand.logo?.kind === "img" && brand.logo.src ? { logo: brand.logo.src } : {}) };
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", name: view.seo.title, description: view.seo.metaDescription, inLanguage: page.lang, ...(url ? { url } : {}), publisher: { "@id": org["@id"] } },
      org,
      ...(questions.length
        ? [{ "@type": "FAQPage", mainEntity: questions.map((q) => ({ "@type": "Question", name: q.question, acceptedAnswer: { "@type": "Answer", text: q.answer } })) }]
        : []),
    ],
  };
}

function PageDocument({ page, brand, uiCss, opts }: { page: Page; brand: Brand; uiCss: string; opts: RenderOptions }) {
  const variant = findVariant(page, opts.variant);
  const view = applyVariant(page, variant);
  const url = opts.origin ? new URL(versionPath(page, variant), opts.origin).href : undefined;
  // Versions are for targeted traffic (email, outreach, ads): search engines are pointed at the general page.
  const canonical = opts.origin ? new URL(versionPath(page, null), opts.origin).href : undefined;
  const hero = view.blocks.find((b) => b.type === "hero");
  const title = view.seo.title || page.title;
  const css = `body { margin: 0; }\n${brand.fontSources.faces.join("\n")}\n${toCss(brand)}\n${uiCss}`;
  const hasForm = view.blocks.some((b) => b.type === "form");

  return (
    <html lang={page.lang || "en"}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <meta name="description" content={view.seo.metaDescription} />
        {opts.noindex ? <meta name="robots" content="noindex, nofollow" /> : null}
        {canonical ? <link rel="canonical" href={canonical} /> : null}
        <meta property="og:type" content="website" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={view.seo.metaDescription} />
        <meta property="og:site_name" content={brand.name} />
        {url ? <meta property="og:url" content={url} /> : null}
        <meta name="twitter:card" content="summary" />
        {brand.fontSources.stylesheets.map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
        <style dangerouslySetInnerHTML={{ __html: cssSafe(css) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: scriptJson(structuredData(page, brand, view, url)) }} />
      </head>
      <body data-page={page.id} data-variant={variant?.slug ?? ""}>
        <div className="lph">
          <Nav
            tone={navTone(brand)}
            logo={<Logo brand={brand} />}
            cta={
              hero?.type === "hero" && hero.primaryCta.label.trim() ? (
                <Button variant={buttonsFor(brand, navTone(brand) === "brand" ? "brand" : "default").primary} href={safeHref(hero.primaryCta.href)}>
                  {hero.primaryCta.label}
                </Button>
              ) : null
            }
          />
          <main>
            {view.blocks.map((b) => (
              <BlockView key={b.id} block={b} brand={brand} formAction={opts.formAction} />
            ))}
          </main>
          <Footer>
            <p className="lph-body">© {brand.name}</p>
          </Footer>
        </div>
        {hasForm ? <script dangerouslySetInnerHTML={{ __html: FORM_SCRIPT }} /> : null}
      </body>
    </html>
  );
}

/**
 * The page as a standalone HTML document: the brand's tokens and the component CSS
 * inline, one H1, SEO and structured data in the head, and the form script when there
 * is a form. Takes the components' CSS as an argument so it runs in the browser (the
 * studio's live preview) as well as in Node (the API and the publisher).
 */
export function renderPage(page: Page, brand: Brand, uiCss: string, opts: RenderOptions = {}): string {
  return `<!doctype html>\n${renderToStaticMarkup(<PageDocument page={page} brand={brand} uiCss={uiCss} opts={opts} />)}\n`;
}

/** Every version of the page as it will be published: the general page first, then each persona's. */
export function renderVersions(page: Page, brand: Brand, uiCss: string, opts: Omit<RenderOptions, "variant"> = {}) {
  return [null, ...page.variants].map((v) => ({
    slug: v?.slug ?? null,
    name: v?.name ?? "General",
    path: versionPath(page, v),
    html: renderPage(page, brand, uiCss, { ...opts, variant: v?.id ?? null }),
  }));
}
