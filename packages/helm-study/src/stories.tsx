/**
 * One list of examples feeds the docs page, the visual-regression screenshots and the
 * parity test, so a variant can't be documented without also being tested.
 */
import type { ReactNode } from "react";
import { Button } from "./components/Button.tsx";
import { Link } from "./components/Link.tsx";
import type { StyleProp } from "./measure.ts";

export interface Story {
  id: string;
  component: "Button" | "Link";
  title: string;
  mode: "light" | "dark";
  render: () => ReactNode;
  /** The live Helm measurement this story must match, and on which properties. */
  parity?: { live: string; props: StyleProp[] };
}

const COLOUR: StyleProp[] = ["backgroundColor", "color", "borderTopWidth", "borderTopColor"];
const BOX: StyleProp[] = ["borderTopLeftRadius", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "columnGap", "height"];
const TYPE: StyleProp[] = ["fontSize", "fontWeight", "lineHeight"];
const MOTION: StyleProp[] = ["transitionDuration", "transitionTimingFunction"];

export const STORIES: Story[] = [
  {
    id: "button-primary",
    component: "Button",
    title: "Primary",
    mode: "light",
    render: () => <Button href="#start">Get started</Button>,
    parity: { live: "Button / primary", props: [...COLOUR, ...BOX, ...TYPE, ...MOTION] },
  },
  {
    id: "button-primary-compact",
    component: "Button",
    title: "Primary, compact",
    mode: "light",
    render: () => (
      <Button href="#sales" size="compact">
        Contact sales
      </Button>
    ),
    // Stripe's navigation sets its own font size and side padding on top of compact, so only what compact itself owns is compared.
    parity: { live: "Button / primary / compact", props: [...COLOUR, "borderTopLeftRadius", "paddingTop", "paddingBottom"] },
  },
  {
    id: "button-secondary-dark",
    component: "Button",
    title: "Secondary, dark mode",
    mode: "dark",
    render: () => (
      <Button href="#github" variant="secondary">
        View the code
      </Button>
    ),
    parity: { live: "Button / secondary", props: [...COLOUR, ...BOX, ...TYPE] },
  },
  {
    id: "button-secondary",
    component: "Button",
    title: "Secondary",
    mode: "light",
    render: () => (
      <Button href="#docs" variant="secondary">
        Read the docs
      </Button>
    ),
  },
  {
    id: "button-native",
    component: "Button",
    title: "As a <button>, no arrow",
    mode: "light",
    render: () => <Button>Save changes</Button>,
  },
  {
    id: "button-disabled",
    component: "Button",
    title: "Disabled",
    mode: "light",
    render: () => (
      <div className="story-row">
        <Button disabled>Primary</Button>
        <Button disabled variant="secondary">
          Secondary
        </Button>
      </div>
    ),
  },
  {
    id: "link-callout",
    component: "Link",
    title: "Callout",
    mode: "light",
    render: () => (
      <Link href="#services" variant="callout">
        View services
      </Link>
    ),
    parity: { live: "Link / callout", props: ["color", "fontSize", "fontWeight", ...MOTION] },
  },
  {
    id: "link-inline",
    component: "Link",
    title: "Inline",
    mode: "light",
    render: () => (
      <p className="story-text">
        Payments settle in two business days. <Link href="#payouts">See payout timing</Link> for your country.
      </p>
    ),
  },
];

export const STORY_CSS = `
body { margin: 0; font-family: var(--sl-font-family); }
.story { display: inline-block; padding: 24px; }
.story.sl-mode-dark { background: var(--sl-page-bg); }
.story-row { display: flex; gap: 16px; }
.story-text { margin: 0; color: var(--sl-page-text); font-size: 16px; }
`;
