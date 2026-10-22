/** @jsxRuntime automatic */
import type { Brand } from "@lph/tokens";
import { Button, Card, Footer, Grid, Hero, LeadForm, Nav, Section } from "./components.tsx";

export function Logo({ brand }: { brand: Brand }) {
  const logo = brand.logo;
  if (logo?.kind === "svg" && logo.svg) {
    // Sanitised at extraction time (scripts, handlers and external links removed).
    return (
      <>
        <span style={{ display: "inline-flex" }} dangerouslySetInnerHTML={{ __html: logo.svg }} />
        {logo.text ? <span>{logo.text}</span> : null}
      </>
    );
  }
  if (logo?.kind === "img" && logo.src) return <img src={logo.src} alt={`${brand.name} logo`} />;
  return <span>{logo?.text ?? brand.name}</span>;
}

/**
 * A sample landing page built only from the starter components. It is how the
 * review screen (and preview.html) shows that the extracted tokens hold up.
 */
export function BrandPreview({ brand }: { brand: Brand }) {
  const filled = brand.buttons.filter((b) => b.kind !== "text");
  const onBrand = filled.filter((b) => b.context === brand.colors.find((c) => c.role === "brand")?.value);
  const onSurface = filled.filter((b) => !onBrand.includes(b));
  const heroCtas = onBrand.length ? onBrand : filled.slice(0, 2);
  // Match where the site puts its header: a logo drawn in the brand colour vanishes on a brand band.
  const navOnBrand = brand.colors.find((c) => c.role === "brand")?.usage.includes("navigation") ?? false;
  const card = (i: number) => brand.cards[i % Math.max(1, brand.cards.length)]?.name ?? "default";

  return (
    <div className="lph">
      <Nav
        tone={navOnBrand ? "brand" : "surface"}
        logo={<Logo brand={brand} />}
        links={[
          { label: "Product", href: "#product" },
          { label: "Customers", href: "#customers" },
          { label: "Pricing", href: "#pricing" },
        ]}
        cta={heroCtas.at(-1) ? <Button variant={heroCtas.at(-1)!.name} href="#demo">Book a demo</Button> : null}
      />
      <Hero
        eyebrow="Preview"
        title={`${brand.name}, rebuilt from its own tokens`}
        lead="Every colour, font, radius and spacing value on this page was measured from the live site."
        actions={heroCtas.slice(0, 2).map((b, i) => (
          <Button key={b.name} variant={b.name} href="#">
            {i === 0 ? "Get started" : "Talk to sales"}
          </Button>
        ))}
        aside={
          <LeadForm
            title="Book a demo"
            submitLabel="Submit"
            variant={onBrand[0]?.name ?? filled[0]?.name}
            fields={[
              { name: "email", label: "Work email", type: "email", placeholder: "you@company.com", required: true },
              { name: "company", label: "Company", placeholder: "Company name" },
            ]}
          />
        }
      />
      <Section eyebrow="Components" title="Cards and buttons" intro="Each card style the site uses, with each button variant on the background it was found on.">
        <Grid>
          {(brand.cards.length ? brand.cards : [{ name: "default" }]).slice(0, 3).map((c, i) => (
            <Card key={c.name} variant={card(i)} title={`${c.name} card`}>
              <p className="lph-body lph-muted">Cards hold features, proof points and pricing tiers.</p>
            </Card>
          ))}
        </Grid>
        <div className="lph-actions">
          {(onSurface.length ? onSurface : filled).map((b) => (
            <Button key={b.name} variant={b.name}>
              {b.name}
            </Button>
          ))}
          {brand.buttons.some((b) => b.name === "link") ? <Button variant="link" href="#">Text link</Button> : null}
        </div>
      </Section>
      <Section tone="subtle" title="Type scale">
        {brand.typography
          .filter((t) => ["display", "h1", "h2", "h3", "h4"].includes(t.role))
          .map((t) => (
            <p key={t.role} className={t.role === "display" ? "lph-display" : `lph-${t.role}`}>
              {t.role} · {t.fontFamily} {t.fontSize}px
            </p>
          ))}
        <p className="lph-body">Body · {brand.fonts.body}. The quick brown fox jumps over the lazy dog.</p>
      </Section>
      <Footer>
        <p className="lph-body">
          {brand.name} · tokens measured from {brand.pages.length} page{brand.pages.length === 1 ? "" : "s"}
        </p>
      </Footer>
    </div>
  );
}
