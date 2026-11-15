# Helm adoption on stripe.com

Read on 2026-11-09 from 25 main marketing pages, as a browser renders them.

**7 of 25 pages run on Helm** (`/`, `/billing`, `/radar`, `/issuing`, `/treasury`, `/about`, `/contact/sales`). 18 still run on the older system, and none mix the two: pages move across whole.

| Page | System | Helm share | Helm elements | Older elements |
|---|---|---|---|---|
| `/` | helm | 96% | 568 | 22 |
| `/payments` | legacy | 0% | 0 | 4239 |
| `/billing` | helm | 97% | 666 | 21 |
| `/connect` | legacy | 0% | 0 | 3763 |
| `/radar` | helm | 94% | 454 | 28 |
| `/terminal` | legacy | 0% | 0 | 3051 |
| `/tax` | legacy | 0% | 0 | 3893 |
| `/atlas` | legacy | 0% | 0 | 2385 |
| `/climate` | legacy | 0% | 0 | 2837 |
| `/issuing` | helm | 97% | 590 | 21 |
| `/treasury` | helm | 100% | 518 | 2 |
| `/capital` | legacy | 0% | 0 | 2335 |
| `/identity` | legacy | 0% | 0 | 2647 |
| `/invoicing` | legacy | 0% | 0 | 3245 |
| `/payments/checkout` | legacy | 0% | 0 | 4926 |
| `/payments/elements` | legacy | 0% | 0 | 3411 |
| `/payments/link` | legacy | 0% | 0 | 2650 |
| `/pricing` | legacy | 0% | 0 | 4660 |
| `/enterprise` | legacy | 0% | 0 | 3173 |
| `/startups` | legacy | 0% | 0 | 3089 |
| `/customers` | legacy | 0% | 0 | 3639 |
| `/about` | helm | 98% | 80 | 2 |
| `/guides` | legacy | 0% | 0 | 3391 |
| `/newsroom` | legacy | 0% | 0 | 2309 |
| `/contact/sales` | helm | 94% | 34 | 2 |

## What's left to move

Elements using each older component across the pages not yet on Helm, next to the Helm component that replaces it.

| Role | Older component | Helm component | Elements left |
|---|---|---|---|
| Button | `CtaButton` | `hds-button` | 482 |
| Hover arrow | `HoverArrow` | `hds-icon-hover-arrow` | 1992 |
| Navigation | `SiteHeader`, `RefreshedNavigation` | `hds-navigation-menu` | 1688 |
| Text | `Copy` | `hds-text`, `hds-heading` | 3081 |
| Link | `Link` | `hds-link` | 3842 |

## Helm components in use

`hds-accent`, `hds-accordion`, `hds-button`, `hds-button-group`, `hds-chippy`, `hds-details`, `hds-details-content`, `hds-field`, `hds-field-error`, `hds-form`, `hds-heading`, `hds-icon`, `hds-icon-chevron-arrow-down`, `hds-icon-hover-arrow`, `hds-input`, `hds-label`, `hds-language`, `hds-link`, `hds-list`, `hds-navigation-menu`, `hds-resource-card`, `hds-select`, `hds-select-value`, `hds-stat`, `hds-stats-block`, `hds-summary`, `hds-tag`, `hds-text`, `hds-textinput`, `hds-ui-button`

*How it's counted:* an element counts as Helm if it has an `hds-` class, and as older if it has a PascalCase block class such as `CtaButton` or `Copy__body`. A page is "helm" above 80% Helm share and "legacy" below 5%.
