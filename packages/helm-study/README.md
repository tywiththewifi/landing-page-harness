# Helm study

An unofficial study of **Helm**, the design system behind stripe.com, built only from what the public site serves. Not affiliated with Stripe.

It started as a bug. Softlander's brand import, run on stripe.com, picked a purple pill as Stripe's primary button. The real primary button is a 4px-radius brand-600 rectangle. The cause: stripe.com is partway through a migration. The home page runs on Helm, `/payments` still runs on the older system, and the extractor measured both and averaged two design systems into one. This package looks at that migration properly, then rebuilds two Helm components and tests them against the live site.

```bash
pnpm --filter @lph/helm-study snapshot   # read stripe.com into data/ (network; a browser, one page at a time)
pnpm --filter @lph/helm-study build      # data/ → tokens.css, report/, docs/ (offline)
pnpm vitest run packages/helm-study      # 44 tests: tokens, adoption, parity, visual regression, axe
```

Open [`docs/index.html`](docs/index.html) for the component docs.

## What it found (9 Nov 2026)

**[Adoption](report/adoption.md).** 7 of 25 main marketing pages run on Helm (`/`, `/billing`, `/radar`, `/issuing`, `/treasury`, `/about`, `/contact/sales`). The other 18 run on the older system, and no page mixes the two, so pages move across whole. On the pages still to move, the report counts the elements each older component covers (`CtaButton` → `hds-button`, `HoverArrow` → `hds-icon-hover-arrow`, and so on).

**[Token graph](report/tokens.md).** Helm publishes 734 custom properties in three tiers: 265 primitive, 261 semantic, 208 component. 274 change value in dark mode. A button colour goes component → semantic → primitive (`--hds-color-button-primary-bg` → `--hds-color-action-bg-solid` → `--hds-color-core-brand-600`), and dark mode swaps only the middle link. The health checks found:

- Three tokens that are read without a fallback and defined nowhere in the CSS. The most likely real one is `--hds-color-text-subtle`: the defined text tokens are `solid`, `soft`, `subdued` and `quiet`, and it colours the calling code in the phone input. A script could still set these at runtime, so they're worth a look, not proof of a bug.
- One contrast miss. In dark mode, white text on the primary button's hover colour (`#5d64fe`) comes to 4.45:1, just under the 4.5:1 that 16px text needs. At rest it's 6.19:1.
- 98 input colours that point straight at primitives. All 98 have their own dark value, so this looks deliberate. The cost is that a change to the semantic layer has to be repeated for each of them.

**[Migration](report/migration.md).** The main button changes a lot when a page moves to Helm. It goes from 33px to 48px tall, from 16.5px to 4px corners, and from `#9966ff` (hover: navy) to brand-600 (hover: brand-700). Its motion changes from 0.15s to 0.3s on a new curve. Anything laid out around the old button needs checking on each page that moves.

## The components

`Button` (primary, secondary; default, compact; link or button; disabled) and `Link` (inline, callout), with the hover arrow, in React and TypeScript. The code is new. The values aren't typed by hand:

- **Tokens are generated.** `build` walks Helm's token graph and writes [`tokens.css`](src/components/tokens.css) in the same three tiers and two modes, renamed into an `--sl-` namespace. Each line names the Helm token it mirrors. Components only read the component tier.
- **Dark mode works the way custom properties do.** A `var()` inside a custom property is resolved on the element that declares it, and the result is what's inherited. So an alias declared on `:root` keeps its light value inside `.sl-mode-dark` unless it's declared again there. The first version got this wrong (the dark example rendered light), and the generator now repeats every alias in the dark scope.
- **Helm's details are kept.** The padding is uneven on purpose (15.5px on top, 16.5px below) because `text-box: trim-both cap alphabetic` trims the line to the cap height. Compact changes only the vertical padding: the 14px text and 20px side padding in Stripe's navigation come from the navigation, not from the button. The arrow's shaft fades in and the arrow moves 6px. Motion turns off under `prefers-reduced-motion`.
- **API choices.** With `href` it renders `<a>`, without it `<button type="button">`, so assistive tech gets the right role. The arrow is on by default for links and off for buttons. There's no `color` or `style` escape hatch: a new need means a new variant or token.

## The tests

| Test | What it holds |
|---|---|
| `parity` | Each story marked `parity` is rendered in Chromium and measured with **the same function that measured live stripe.com**, then compared property by property at rest and on hover (colour, border, radius, padding, height, type, motion, arrow travel). It caught that Helm buttons are `border-box`: mine measured 16px tall until that was fixed. |
| `visual` | Every story at rest and on hover, plus a keyboard focus state, compared pixel by pixel with committed baselines in `test/__screenshots__`. Inter is inlined so text renders the same on any machine. The diff runs on a canvas in Chromium, so no image library is needed. `UPDATE_SCREENSHOTS=1` rewrites the baselines after an intended change. |
| `a11y` | The docs page (at phone and desktop widths) and every story pass axe (WCAG 2.2 AA plus best practices), using Softlander's publish-gate runner. It caught two problems on the docs page: tables that scrolled sideways on phones weren't keyboard-focusable, and two regions had the same name. |
| `build` | `tokens.css` matches the snapshot; every generated token resolves to exactly what Helm's own token resolves to, in both modes; tiers only point downwards; `components.css` has no colour literals and reads only component tokens. |
| `tokens`, `adoption` | The graph parser and page classifier on small fixtures: `@layer` counts and `@media` doesn't, `@property` defaults count as definitions, fallbacks separate inputs from dangling references, and so on. |

## For agents

[`docs/components.json`](docs/components.json) describes each component's props, the rules for using them ("one primary per view", "`href` for navigation, none for actions"), the modes and every component token with its light and dark value. An agent can read it and write correct markup without opening the source.

## Limits

- It reads what stripe.com serves to the public. Helm's source, Figma library and docs aren't public, so names like "primitive" and "semantic" are my reading of its naming, not Stripe's terms.
- The token graph comes from the four stylesheets the home page loads. Components that only load on other pages are missing, which is why "defined but never read" is high.
- Söhne is licensed, so the components use Inter. Parity compares everything except the font.
- The extractor fix this started from (noticing when one site runs two design systems) isn't in this package yet.
