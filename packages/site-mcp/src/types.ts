export type PageType =
  | "home"
  | "case-study"
  | "article"
  | "press"
  | "event"
  | "product"
  | "integration"
  | "careers"
  | "legal"
  | "contact"
  | "page";

export interface Page {
  url: string;
  path: string;
  type: PageType;
  lang: string;
  title: string;
  description: string;
  image?: string;
  /** Headings in document order, as "## Heading". */
  outline: string[];
  /** Main content as plain Markdown, without the site's header, nav and footer. */
  markdown: string;
  /** Short figures pulled from the page, like "30%" or "325,000 customers". */
  stats: string[];
  /** Same-site links found in the main content. */
  links: string[];
  jsonLd: unknown[];
  lastModified?: string;
  fetchedAt: string;
}

export interface Snapshot {
  version: 1;
  origin: string;
  name: string;
  crawledAt: string;
  userAgent: string;
  /** Paths robots.txt kept us out of, so a client knows what is missing. */
  skipped: { url: string; reason: string }[];
  pages: Page[];
}
