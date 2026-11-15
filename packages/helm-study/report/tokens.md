# Helm's token graph

Rebuilt on 2026-11-09 from the 4 stylesheets stripe.com's home page loads. Only custom-property declarations and `var()` references were read.

## Shape

| | Tokens |
|---|---|
| Primitive (`color-core-*`, `color-util-*`, `space-core-*`, font weights and families) | 265 |
| Semantic (`color-action-*`, `color-surface-*`, `color-text-*`, layout and section spacing, type roles) | 261 |
| Component (`color-button-*`, `color-input-*`, `toggle-tabs-*`, ...) | 208 |
| **Total** | **734** |

274 tokens resolve to a different value in dark mode (`.hds-mode--dark`) than in light. Buttons reach their colours through all three tiers: `--hds-color-button-primary-bg` → `--hds-color-action-bg-solid` → `--hds-color-core-brand-600` (`#533afd`), and dark mode swaps only the middle link, to `brandDark-600`.

## Health checks

**References to tokens defined nowhere (3).** Read with no fallback, so the property drops silently unless a script sets the token at runtime. Worth a look, not proof of a bug:

- `--hds-dialog-blur-height`
- `--hds-color-text-subtle`
- `--hds-font-weight-medium`

The two worth checking first: `--hds-color-text-subtle` (the defined text tokens are `solid`, `soft`, `subdued` and `quiet`, so this reads like a renamed token; it colours the calling code in the phone input) and `--hds-font-weight-medium` (only `bold` and `normal` exist).

**Inputs with a fallback (4).** Read with a default and never defined, so they're settings a consumer can pass in: `--hds-chippy-link-offset-y`, `--hds-navigation-menu-popup-height`, `--hds-resource-card-text-lines`, `--hds-select-tile-group-cols`.

**Defined but never read in these stylesheets (226).** Expected for a system: many belong to components the home page doesn't load, or are read by script. A full-site pass would narrow this list.

**Component tokens that skip the semantic layer (98).** These point a component colour straight at a primitive. 98 of the 98 have their own dark-mode value, so this looks deliberate: these components are themed directly, mode by mode, rather than through the semantic layer. The cost is that a change to the semantic layer, such as a brand refresh, has to be repeated here. 95 are input colours:

- `--hds-color-input-bg-accent` → `--hds-color-core-brand-600`
- `--hds-color-input-bg-disabled` → `--hds-color-core-neutral-50A`
- `--hds-color-input-bg-hover` → `--hds-color-core-brand-25`
- `--hds-color-input-bg-listboxIcon` → `--hds-color-core-neutral-50`
- `--hds-color-input-bg-popover` → `--hds-color-core-neutral-0`
- `--hds-color-input-bg-quiet` → `--hds-color-core-neutral-100`
- `--hds-color-input-bg-selectorActive` → `--hds-color-core-brand-400`
- `--hds-color-input-bg-solid` → `--hds-color-core-neutral-0`
- `--hds-color-input-border-accent` → `--hds-color-core-brand-600`
- `--hds-color-input-border-disabled` → `--hds-color-core-neutral-100`
- `--hds-color-input-border-error` → `--hds-color-core-error-500`
- `--hds-color-input-border-errorBlur` → `--hds-color-core-error-100`
- ...and 86 more

**Semantic tokens that point at a component token (0).** None: the layers only point downwards.

## Contrast of button and link colours

Resolved through the graph in each mode. Labels are 16px, so the bar is 4.5:1. A transparent background is checked against the mode's quiet surface.

| Pair | Mode | Text | Background | Ratio | |
|---|---|---|---|---|---|
| Primary button | light | `#fff` | `#533afd` | 6.19 | pass |
| Primary button | dark | `#fff` | `#533afd` | 6.19 | pass |
| Primary button, hover | light | `#fff` | `#4032c8` | 8.37 | pass |
| Primary button, hover | dark | `#fff` | `#5d64fe` | 4.45 | **fail** |
| Secondary button | light | `#533afd` | `#ffffff00` | 6.19 | pass |
| Secondary button | dark | `#fff` | `#ffffff00` | 17.55 | pass |
| Link | light | `#533afd` | `#fff` | 6.19 | pass |
| Link | dark | `#7389ff` | `#0d1738` | 5.64 | pass |
| Link, hover | light | `#2e2b8c` | `#fff` | 11.41 | pass |
| Link, hover | dark | `#a8bfff` | `#0d1738` | 9.66 | pass |
| Soft text | light | `#50617a` | `#fff` | 6.3 | pass |
| Soft text | dark | `#a3b5d6` | `#0d1738` | 8.47 | pass |

1 pair(s) fall short of 4.5:1.
