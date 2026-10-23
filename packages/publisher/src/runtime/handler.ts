// The form endpoint on a self-hosted site: a Cloudflare Pages Function. The publisher
// copies this file and @lph/forms into the site's functions folder, so it has no
// dependencies. Web APIs only.
import { deliver, parseSubmission, type Connector, type DeliveryResult, type FormFieldConfig } from "@lph/forms";

/** One page's form, as the publisher writes it into forms.json. Secrets stay in the environment. */
export interface FormConfig {
  pageId: string;
  pageName: string;
  fields: FormFieldConfig[];
  successMessage: string;
  connector: { kind: "none" } | { kind: "webhook"; url: string } | { kind: "hubspot"; portalId: string; formId: string };
}

export interface FormEnv {
  /** Signs webhook posts. */
  LPH_WEBHOOK_SECRET?: string;
  /** A HubSpot private app token: uses the authenticated endpoint. */
  HUBSPOT_ACCESS_TOKEN?: string;
  /** A KV namespace. When bound, every lead is kept for 90 days with what happened when it was sent on. */
  LEADS?: { put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> };
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Visitors with scripts off get a page back instead of JSON. */
function page(title: string, body: string, back: string | null, status: number): Response {
  const link = back ? `<p><a href="${escape(back)}">Back to the page</a></p>` : "";
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escape(title)}</title></head><body style="font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem"><h1>${escape(title)}</h1>${body}${link}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

async function readBody(request: Request): Promise<unknown> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) return request.json().catch(() => null);
  const form = await request.formData().catch(() => null);
  if (!form) return null;
  const out: Record<string, string> = {};
  form.forEach((value, key) => {
    if (typeof value === "string") out[key] = value;
  });
  return out;
}

export async function handleForm(request: Request, config: FormConfig | undefined, env: FormEnv, opts: { fetch?: typeof fetch } = {}): Promise<Response> {
  const wantsHtml = !(request.headers.get("accept") ?? "").includes("application/json") && (request.headers.get("accept") ?? "").includes("text/html");
  const back = request.headers.get("referer");
  const json = (data: unknown, status = 200) => Response.json(data, { status });
  if (request.method !== "POST") return json({ error: "Use POST" }, 405);
  if (!config) return json({ error: "Form not found" }, 404);

  const parsed = parseSubmission(await readBody(request), config.fields);
  if (!parsed.ok) {
    const message = "Please check the highlighted fields.";
    if (wantsHtml) return page("Please check the form", `<ul>${Object.values(parsed.errors).map((e) => `<li>${escape(String(e))}</li>`).join("")}</ul>`, back, 422);
    return json({ message, errors: parsed.errors }, 422);
  }
  const thanks = () => (wantsHtml ? page("Thanks", `<p>${escape(config.successMessage)}</p>`, back, 200) : json({ ok: true, message: config.successMessage }));
  // Bots that fill the hidden field are told it worked and nothing is kept.
  if (parsed.spam) return thanks();

  const c = config.connector;
  const connector: Connector =
    c.kind === "webhook" ? { ...c, secret: env.LPH_WEBHOOK_SECRET } : c.kind === "hubspot" ? { ...c, token: env.HUBSPOT_ACCESS_TOKEN } : c;
  const id = crypto.randomUUID();
  const result: DeliveryResult = await deliver(parsed.submission, connector, {
    pageId: config.pageId,
    ipAddress: request.headers.get("cf-connecting-ip") ?? undefined,
    fetch: opts.fetch,
  });
  const now = new Date().toISOString();
  if (env.LEADS) {
    const record = { ...parsed.submission, id, pageId: config.pageId, receivedAt: now, delivery: { status: result.status, connector: c.kind, ...(result.detail && { detail: result.detail }) } };
    await env.LEADS.put(`lead:${config.pageId}:${now}:${id}`, JSON.stringify(record), { expirationTtl: 90 * 24 * 3600 });
  }
  if (!result.ok) {
    console.error(`Form ${config.pageId}, lead ${id}: ${result.detail}`);
    return wantsHtml ? page("That didn't go through", `<p>${escape(result.message)}</p>`, back, 502) : json({ ok: false, message: result.message }, 502);
  }
  return thanks();
}
