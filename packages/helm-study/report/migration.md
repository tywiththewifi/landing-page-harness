# Moving a page's main button to Helm

The main call to action on `/payments` ("Start accepting payments", older `CtaButton`) next to the one on `/` ("Get started", Helm `hds-button--primary`), both as rendered.

| | Older `CtaButton` | Helm `hds-button--primary` |
|---|---|---|
| Background | rgb(153, 102, 255) | rgb(83, 58, 253) |
| Background on hover | rgb(10, 37, 64) | rgb(64, 50, 200) |
| Corner radius | 16.5px | 4px |
| Height | 33px | 48px |
| Padding (top right bottom left) | 3px 12px 6px 16px | 15.5px 24px 16.5px 24px |
| Type | 15px / 24px, weight 425, tracking 0.2px | 16px / 16px, weight 400, tracking normal |
| Motion | 0.15s cubic-bezier(0.215, 0.61, 0.355, 1) | 0.3s cubic-bezier(0.25, 1, 0.5, 1) |
| Hover arrow | animates its own path | slides 6px, shaft fades in |

Moving a page across isn't a rename: the button's height changes by 15px, its corners go from 16.5px to 4px, and both its colour and its hover colour change. Anything laid out around the old 33px button (hero spacing, button rows) needs checking on each page that moves.

This is also where Softlander's own extractor went wrong on stripe.com: it measured the home page (Helm) and `/payments` (older) together and picked the older pill as the primary button, because it appeared on more elements. It needs to notice when one site runs two systems.
