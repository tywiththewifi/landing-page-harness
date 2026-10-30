import type { Submission } from "./submission.ts";

/**
 * Where a page's leads go. Secrets (the webhook signing secret, a HubSpot private app
 * token) come from the server's environment, never from the page.
 */
export type Connector =
  | { kind: "none" }
  | { kind: "webhook"; url: string; secret?: string }
  | { kind: "hubspot"; portalId: string; formId: string; token?: string };

export interface DeliveryResult {
  ok: boolean;
  /** "stored" when there is no connector: the caller keeps the lead for testing. */
  status: "sent" | "stored" | "failed";
  /** Safe to show the visitor. */
  message: string;
  /** For logs and the studio, never for the visitor. */
  detail?: string;
}

export interface DeliveryMeta {
  pageId: string;
  /** The visitor's IP, passed to HubSpot for its spam and location checks. */
  ipAddress?: string;
  fetch?: typeof fetch;
  now?: Date;
  /** Request timeout in milliseconds. */
  timeout?: number;
}

const FAILED = "Sorry, that didn't go through. Please try again in a moment.";

/** The JSON a webhook receives. */
export function webhookBody(submission: Submission, meta: { pageId: string; id: string; now: Date }) {
  return {
    type: "lead",
    id: meta.id,
    pageId: meta.pageId,
    variant: submission.context.variant,
    submittedAt: meta.now.toISOString(),
    fields: submission.values,
    context: submission.context,
  };
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function hmac(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
}

/**
 * Signs a webhook body the way Stripe does: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">`.
 * The timestamp lets the receiver reject replays. Uses Web Crypto, so it runs in Node,
 * Cloudflare Workers and browsers alike.
 */
export async function signWebhook(body: string, secret: string, now = new Date()): Promise<string> {
  const t = Math.floor(now.getTime() / 1000);
  return `t=${t},v1=${await hmac(secret, `${t}.${body}`)}`;
}

/** For receivers: true when the signature matches and is under `tolerance` seconds old. */
export async function verifyWebhook(body: string, header: string, secret: string, opts: { tolerance?: number; now?: Date } = {}): Promise<boolean> {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1) return false;
  const age = Math.abs((opts.now ?? new Date()).getTime() / 1000 - t);
  if (age > (opts.tolerance ?? 300)) return false;
  const expected = await hmac(secret, `${t}.${body}`);
  // Constant time compare: the lengths are fixed, so only the content can differ.
  if (expected.length !== parts.v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ parts.v1.charCodeAt(i);
  return diff === 0;
}

/** HubSpot's Forms API v3. With a private app token the authenticated endpoint is used, which has higher rate limits. */
export const hubspotEndpoint = (portalId: string, formId: string, secure = false) =>
  `https://api.hsforms.com/submissions/v3/integration/${secure ? "secure/" : ""}submit/${encodeURIComponent(portalId)}/${encodeURIComponent(formId)}`;

/** The body HubSpot expects: contact properties (object type 0-1) plus the page context. */
export function hubspotBody(submission: Submission, opts: { ipAddress?: string; now?: Date } = {}) {
  const { context } = submission;
  return {
    submittedAt: String((opts.now ?? new Date()).getTime()),
    fields: Object.entries(submission.values).map(([name, value]) => ({ objectTypeId: "0-1", name, value })),
    context: {
      ...(context.pageUri && { pageUri: context.pageUri }),
      ...(context.pageName && { pageName: context.pageName }),
      ...(context.hutk && { hutk: context.hutk }),
      ...(opts.ipAddress && { ipAddress: opts.ipAddress }),
    },
  };
}

async function post(url: string, init: RequestInit, meta: DeliveryMeta): Promise<Response> {
  return (meta.fetch ?? fetch)(url, { ...init, method: "POST", signal: AbortSignal.timeout(meta.timeout ?? 10_000) });
}

/** Sends one lead to its connector. Never throws: a failure comes back as a result to log and show. */
export async function deliver(submission: Submission, connector: Connector, meta: DeliveryMeta): Promise<DeliveryResult> {
  const now = meta.now ?? new Date();
  try {
    if (connector.kind === "none") return { ok: true, status: "stored", message: "Thanks, we got it.", detail: "No connector is set up, so the lead was kept for testing." };

    if (connector.kind === "webhook") {
      const body = JSON.stringify(webhookBody(submission, { pageId: meta.pageId, id: crypto.randomUUID(), now }));
      const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "softlander", "x-lph-event": "lead" };
      if (connector.secret) headers["x-lph-signature"] = await signWebhook(body, connector.secret, now);
      // Redirects aren't followed: the URL was checked, wherever it redirects to wasn't.
      const res = await post(connector.url, { headers, body, redirect: "manual" }, meta);
      if (res.ok) return { ok: true, status: "sent", message: "Thanks, we got it." };
      return { ok: false, status: "failed", message: FAILED, detail: `The webhook answered ${res.status}.` };
    }

    const secure = !!connector.token;
    const res = await post(
      hubspotEndpoint(connector.portalId, connector.formId, secure),
      {
        headers: { "content-type": "application/json", ...(secure && { authorization: `Bearer ${connector.token}` }) },
        body: JSON.stringify(hubspotBody(submission, { ipAddress: meta.ipAddress, now })),
      },
      meta,
    );
    // HubSpot's own thank-you message is HTML set in HubSpot; the page shows its own instead.
    if (res.ok) return { ok: true, status: "sent", message: "Thanks, we got it.", detail: "HubSpot accepted the lead." };
    const data = (await res.json().catch(() => ({}))) as { errors?: { message: string; errorType: string }[]; message?: string };
    const types = data.errors?.map((e) => e.errorType) ?? [];
    const detail = types.includes("FORM_HAS_RECAPTCHA_ENABLED")
      ? "The HubSpot form has CAPTCHA turned on, which blocks API submissions. Turn it off in the form's settings."
      : `HubSpot answered ${res.status}: ${data.errors?.map((e) => e.message).join("; ") || data.message || "no details"}`;
    // Field errors (an invalid or blocked email) are the visitor's to fix.
    const visitor = types.some((t) => t === "INVALID_EMAIL" || t === "BLOCKED_EMAIL") ? "Please check your email address and try again." : FAILED;
    return { ok: false, status: "failed", message: visitor, detail };
  } catch (err) {
    return { ok: false, status: "failed", message: FAILED, detail: (err as Error).name === "TimeoutError" ? "The request timed out." : (err as Error).message };
  }
}
