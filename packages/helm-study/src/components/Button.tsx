import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { HoverArrow } from "./HoverArrow.tsx";

export type ButtonVariant = "primary" | "secondary";
export type ButtonSize = "default" | "compact";

interface Common {
  /** primary: the one main action in a view. secondary: everything next to it. */
  variant?: ButtonVariant;
  /** compact is for dense places such as navigation; it only tightens the vertical padding. */
  size?: ButtonSize;
  /** The arrow that slides right on hover. On by default for links that go somewhere new. */
  arrow?: boolean;
  children: ReactNode;
}

/** With href it renders a link; without, a button. The styling is identical, the semantics aren't. */
export type ButtonProps =
  | (Common & { href: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children">)
  | (Common & { href?: undefined } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">);

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "default", extra?: string) {
  return ["sl-button", `sl-button--${variant}`, size === "compact" && "sl-button--compact", extra].filter(Boolean).join(" ");
}

export function Button(props: ButtonProps) {
  const { variant = "primary", size = "default", arrow, children, className, ...rest } = props;
  const cls = buttonClass(variant, size, className);
  if (rest.href !== undefined) {
    const { href, ...anchor } = rest as AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };
    return (
      <a className={cls} href={href} {...anchor}>
        {children}
        {(arrow ?? true) && <HoverArrow />}
      </a>
    );
  }
  const { type = "button", ...button } = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button className={cls} type={type} {...button}>
      {children}
      {arrow && <HoverArrow />}
    </button>
  );
}
