import { FIELDS, HONEYPOT, type FieldName, type FormFieldConfig } from "./fields.ts";

/** Where a lead came from. Sent to HubSpot as its submission context, and to webhooks as is. */
export interface SubmissionContext {
  /** The full URL the visitor submitted from, query string included, so UTMs are attributed. */
  pageUri: string;
  pageName: string;
  /** The page version (persona variant slug), or null for the general page. */
  variant: string | null;
  /** HubSpot's tracking cookie, which links the lead to their earlier visits. */
  hutk?: string;
  utm: Partial<Record<(typeof UTM)[number], string>>;
  referrer?: string;
}

export interface Submission {
  values: Partial<Record<FieldName, string>>;
  context: SubmissionContext;
}

export type ParseResult =
  | { ok: true; submission: Submission; spam: boolean }
  | { ok: false; errors: Partial<Record<FieldName, string>> };

const UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^[+\d][\d\s().-]{4,39}$/;
const HUTK = /^[a-f0-9]{32}$/i;
const VARIANT = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function httpUrl(v: string): string {
  try {
    const url = new URL(v);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function invalid(name: FieldName, value: string): boolean {
  if (value.length > FIELDS[name].max) return true;
  if (name === "email") return !EMAIL.test(value);
  if (name === "phone") return !PHONE.test(value);
  if (name === "website") return !httpUrl(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  return false;
}

/**
 * Reads a form post: JSON from the page's script ({ fields, context }), or the flat
 * urlencoded body a browser sends with scripts off. Only the fields the form asks for
 * are kept. A filled honeypot marks the post as spam, which callers accept and drop
 * so bots learn nothing.
 */
export function parseSubmission(input: unknown, fields: FormFieldConfig[]): ParseResult {
  const body = isRecord(input) ? input : {};
  const raw = isRecord(body.fields) ? body.fields : body;
  const ctx = isRecord(body.context) ? body.context : body;

  const values: Submission["values"] = {};
  const errors: Partial<Record<FieldName, string>> = {};
  for (const f of fields) {
    const value = typeof raw[f.name] === "string" ? (raw[f.name] as string).trim() : "";
    if (!value) {
      if (f.required) errors[f.name] = `${f.label} is required.`;
      continue;
    }
    if (invalid(f.name, value)) {
      errors[f.name] = value.length > FIELDS[f.name].max ? `${f.label} is too long.` : `Enter a valid ${f.label.toLowerCase()}.`;
      continue;
    }
    values[f.name] = value;
  }
  if (Object.keys(errors).length) return { ok: false, errors };

  const utmSource = isRecord(ctx.utm) ? ctx.utm : ctx;
  const utm: SubmissionContext["utm"] = {};
  for (const key of UTM) {
    const v = str(utmSource[key], 200);
    if (v) utm[key] = v;
  }
  const variant = str(ctx.variant, 60);
  const hutk = str(ctx.hutk, 64);
  const referrer = httpUrl(str(ctx.referrer, 2000));
  return {
    ok: true,
    spam: str(body[HONEYPOT] ?? raw[HONEYPOT], 500) !== "",
    submission: {
      values,
      context: {
        pageUri: httpUrl(str(ctx.pageUri, 2000)),
        pageName: str(ctx.pageName, 300),
        variant: VARIANT.test(variant) ? variant : null,
        ...(HUTK.test(hutk) && { hutk }),
        utm,
        ...(referrer && { referrer }),
      },
    },
  };
}
