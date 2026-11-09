import type { AnchorHTMLAttributes, ReactNode } from "react";
import { HoverArrow } from "./HoverArrow.tsx";

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children"> {
  href: string;
  /** callout: a standalone link with the hover arrow, such as "View services". inline: inside a sentence. */
  variant?: "callout" | "inline";
  children: ReactNode;
}

export function Link({ variant = "inline", children, className, ...rest }: LinkProps) {
  const cls = ["sl-link", `sl-link--${variant}`, className].filter(Boolean).join(" ");
  return (
    <a className={cls} {...rest}>
      {children}
      {variant === "callout" && <HoverArrow />}
    </a>
  );
}
