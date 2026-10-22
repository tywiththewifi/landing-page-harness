/**
 * The brand model shared by every package. Values are always measured from a
 * site's rendered CSS. Names, descriptions and rules can be written by a model,
 * but a model never sets a value.
 */

/** Where a value was observed. */
export interface Source {
  /** URL of the sampled page. */
  page: string;
  /** Short CSS path to one element that carries the value. */
  selector: string;
  /** How many elements on that page shared the value. */
  count: number;
}

export interface Provenance {
  sources: Source[];
  /** 0..1. How consistently the value appeared across elements and pages. */
  confidence: number;
}

export type ColorRole = "brand" | "accent" | "ink" | "surface" | "neutral";

export interface ColorToken extends Provenance {
  /** Kebab-case token name, e.g. "primary-green". */
  name: string;
  /** Lowercase #rrggbb. */
  value: string;
  role: ColorRole;
  /** Plain-language notes on where the colour is used. */
  usage: string[];
}

export type TypeRole = "display" | "h1" | "h2" | "h3" | "h4" | "body" | "small" | "label";

export interface TypeToken extends Provenance {
  role: TypeRole;
  fontFamily: string;
  /** px */
  fontSize: number;
  /** px on a 390px-wide viewport, when measured. */
  mobileFontSize?: number;
  fontWeight: number;
  /** px */
  lineHeight: number;
  /** px */
  letterSpacing: number;
  textTransform: "none" | "uppercase" | "lowercase" | "capitalize";
}

export interface SizeToken extends Provenance {
  name: string;
  /** px. Radius tokens use 9999 for a pill. */
  value: number;
}

export type ButtonKind = "filled" | "outline" | "text";

export interface ButtonStyle extends Provenance {
  name: string;
  kind: ButtonKind;
  background: string | null;
  color: string;
  borderColor: string | null;
  borderWidth: number;
  radius: number;
  paddingX: number;
  paddingY: number;
  fontSize: number;
  fontWeight: number;
  textTransform: TypeToken["textTransform"];
  /** Background the button sat on when sampled, used for previews and contrast. */
  context: string;
  sampleText: string;
}

export interface CardStyle extends Provenance {
  name: string;
  background: string;
  borderColor: string | null;
  borderWidth: number;
  radius: number;
  shadow: string | null;
  padding: number;
  context: string;
}

export interface InputStyle extends Provenance {
  background: string;
  color: string;
  borderColor: string | null;
  borderWidth: number;
  radius: number;
  paddingX: number;
  paddingY: number;
  fontSize: number;
}

export interface Logo {
  kind: "svg" | "img" | "text";
  /** Inline SVG markup when kind is "svg". */
  svg?: string;
  /** Absolute URL when kind is "img". */
  src?: string;
  text?: string;
  source: Source;
}

/** Two or more measured values competing for the same slot. The user picks one. */
export interface Conflict {
  id: string;
  /** Dotted path into the brand, e.g. "fonts.body". */
  field: string;
  message: string;
  options: { value: string; sources: Source[]; share: number }[];
  resolved?: string;
  /** True once a person has picked an option (the default pick is the most common value). */
  reviewed?: boolean;
}

export interface Brand {
  id: string;
  name: string;
  url: string;
  pages: string[];
  createdAt: string;
  updatedAt: string;
  summary: string;
  logo: Logo | null;
  fonts: { heading: string; body: string };
  colors: ColorToken[];
  typography: TypeToken[];
  radii: SizeToken[];
  spacing: SizeToken[];
  buttons: ButtonStyle[];
  cards: CardStyle[];
  input: InputStyle | null;
  usageRules: string[];
  conflicts: Conflict[];
  /** Things the extractor could not do, shown to the user. */
  warnings: string[];
  /** CSS custom properties the site already declares on :root. */
  declaredVariables: Record<string, string>;
  /** How to load the brand's web fonts: @font-face rules and hosted stylesheet URLs. */
  fontSources: { faces: string[]; stylesheets: string[] };
}
