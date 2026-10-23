import { describe, expect, it } from "vitest";
import { FIELDS, deliver, hubspotBody, hubspotEndpoint, parseSubmission, signWebhook, verifyWebhook, type FormFieldConfig, type Submission } from "../src/index.ts";

const fields: FormFieldConfig[] = [
  { name: "email", label: "Work email", required: true },
  { name: "firstname", label: "First name", required: true },
  { name: "company", label: "Company", required: false },
  { name: "website", label: "Company website", required: false },
];

const ok = (input: unknown) => {
  const r = parseSubmission(input, fields);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r;
};

describe("parseSubmission", () => {
  it("reads the page script's JSON and keeps only the form's fields", () => {
    const r = ok({
      fields: { email: " ada@example.com ", firstname: "Ada", company: "", password: "nope" },
      _hp: "",
      context: {
        pageUri: "https://northloop.example/hubspot?utm_source=newsletter",
        pageName: "HubSpot integration",
        variant: "revops-leads",
        hutk: "0123456789abcdef0123456789abcdef",
        utm: { utm_source: "newsletter", utm_medium: "email", other: "x" },
        referrer: "javascript:alert(1)",
      },
    });
    expect(r.spam).toBe(false);
    expect(r.submission.values).toEqual({ email: "ada@example.com", firstname: "Ada" });
    expect(r.submission.context).toEqual({
      pageUri: "https://northloop.example/hubspot?utm_source=newsletter",
      pageName: "HubSpot integration",
      variant: "revops-leads",
      hutk: "0123456789abcdef0123456789abcdef",
      utm: { utm_source: "newsletter", utm_medium: "email" },
    });
  });

  it("reads a flat urlencoded post from a browser with scripts off", () => {
    const body = Object.fromEntries(new URLSearchParams("email=ada%40example.com&firstname=Ada&utm_campaign=launch&variant=Bad%20Slug"));
    const r = ok(body);
    expect(r.submission.values.email).toBe("ada@example.com");
    expect(r.submission.context.utm).toEqual({ utm_campaign: "launch" });
    expect(r.submission.context.variant).toBeNull();
  });

  it("explains each field that's missing or wrong", () => {
    const r = parseSubmission({ fields: { email: "not-an-email", firstname: "", website: "not a url" } }, fields);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual({ email: "Enter a valid work email.", firstname: "First name is required.", website: "Enter a valid company website." });
  });

  it("accepts a website without its scheme and rejects over-long values", () => {
    expect(ok({ email: "a@b.co", firstname: "A", website: "northloop.example" }).submission.values.website).toBe("northloop.example");
    const r = parseSubmission({ email: "a@b.co", firstname: "x".repeat(FIELDS.firstname.max + 1) }, fields);
    expect(r.ok || r.errors.firstname).toBe("First name is too long.");
  });

  it("marks a filled honeypot as spam", () => {
    expect(ok({ email: "a@b.co", firstname: "A", _hp: "http://spam" }).spam).toBe(true);
    expect(ok({ fields: { email: "a@b.co", firstname: "A", _hp: "x" } }).spam).toBe(true);
  });
});

const submission: Submission = {
  values: { email: "ada@example.com", firstname: "Ada" },
  context: { pageUri: "https://northloop.example/hubspot", pageName: "HubSpot integration", variant: null, hutk: "0123456789abcdef0123456789abcdef", utm: {} },
};

/** A fetch that records requests and answers with the given response. */
const recorder = (respond: () => Response) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string, init: RequestInit) => (calls.push({ url, init }), respond())) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
};

describe("HubSpot", () => {
  it("builds the Forms API v3 body with contact properties and the page context", () => {
    const body = hubspotBody(submission, { ipAddress: "203.0.113.7", now: new Date(1_760_000_000_000) });
    expect(body).toEqual({
      submittedAt: "1760000000000",
      fields: [
        { objectTypeId: "0-1", name: "email", value: "ada@example.com" },
        { objectTypeId: "0-1", name: "firstname", value: "Ada" },
      ],
      context: { pageUri: "https://northloop.example/hubspot", pageName: "HubSpot integration", hutk: "0123456789abcdef0123456789abcdef", ipAddress: "203.0.113.7" },
    });
    expect(hubspotEndpoint("123", "abc")).toBe("https://api.hsforms.com/submissions/v3/integration/submit/123/abc");
    expect(hubspotEndpoint("123", "abc", true)).toBe("https://api.hsforms.com/submissions/v3/integration/secure/submit/123/abc");
  });

  it("uses the authenticated endpoint when a private app token is set", async () => {
    const { fetch, calls } = recorder(() => Response.json({ inlineMessage: "<p>Thanks</p>" }));
    const result = await deliver(submission, { kind: "hubspot", portalId: "123", formId: "f-1", token: "pat-secret" }, { pageId: "p1", fetch });
    expect(result).toMatchObject({ ok: true, status: "sent" });
    expect(calls[0]!.url).toBe(hubspotEndpoint("123", "f-1", true));
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer pat-secret");
  });

  it("turns HubSpot's errors into a message for the visitor and a detail for the logs", async () => {
    const captcha = recorder(() => Response.json({ errors: [{ message: "captcha", errorType: "FORM_HAS_RECAPTCHA_ENABLED" }] }, { status: 400 }));
    const r1 = await deliver(submission, { kind: "hubspot", portalId: "1", formId: "f" }, { pageId: "p1", fetch: captcha.fetch });
    expect(r1).toMatchObject({ ok: false, status: "failed" });
    expect(r1.detail).toMatch(/CAPTCHA/);
    const email = recorder(() => Response.json({ errors: [{ message: "Email blocked", errorType: "BLOCKED_EMAIL" }] }, { status: 400 }));
    const r2 = await deliver(submission, { kind: "hubspot", portalId: "1", formId: "f" }, { pageId: "p1", fetch: email.fetch });
    expect(r2.message).toMatch(/email address/);
  });
});

describe("webhook", () => {
  it("posts a signed JSON lead without following redirects", async () => {
    const { fetch, calls } = recorder(() => new Response(null, { status: 204 }));
    const now = new Date("2026-10-22T08:00:00Z");
    const result = await deliver(submission, { kind: "webhook", url: "https://hooks.example/lead", secret: "s3cret" }, { pageId: "p1", fetch, now });
    expect(result.status).toBe("sent");
    const { url, init } = calls[0]!;
    expect(url).toBe("https://hooks.example/lead");
    expect(init.redirect).toBe("manual");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ type: "lead", pageId: "p1", variant: null, submittedAt: now.toISOString(), fields: submission.values });
    const sig = (init.headers as Record<string, string>)["x-lph-signature"]!;
    expect(await verifyWebhook(init.body as string, sig, "s3cret", { now })).toBe(true);
  });

  it("rejects tampered, wrongly signed and stale signatures", async () => {
    const now = new Date("2026-10-22T08:00:00Z");
    const sig = await signWebhook('{"a":1}', "s3cret", now);
    expect(await verifyWebhook('{"a":2}', sig, "s3cret", { now })).toBe(false);
    expect(await verifyWebhook('{"a":1}', sig, "other", { now })).toBe(false);
    expect(await verifyWebhook('{"a":1}', sig, "s3cret", { now: new Date(now.getTime() + 10 * 60_000) })).toBe(false);
    expect(await verifyWebhook('{"a":1}', "garbage", "s3cret", { now })).toBe(false);
  });

  it("reports a failing or unreachable webhook without throwing", async () => {
    const down = recorder(() => new Response("nope", { status: 500 }));
    expect(await deliver(submission, { kind: "webhook", url: "https://hooks.example/lead" }, { pageId: "p1", fetch: down.fetch })).toMatchObject({ ok: false, detail: "The webhook answered 500." });
    const moved = recorder(() => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }));
    expect((await deliver(submission, { kind: "webhook", url: "https://hooks.example/lead" }, { pageId: "p1", fetch: moved.fetch })).ok).toBe(false);
    const broken = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await deliver(submission, { kind: "webhook", url: "https://hooks.example/lead" }, { pageId: "p1", fetch: broken })).toMatchObject({ ok: false, detail: "fetch failed" });
  });

  it("keeps the lead for testing when there's no connector", async () => {
    expect(await deliver(submission, { kind: "none" }, { pageId: "p1" })).toMatchObject({ ok: true, status: "stored" });
  });
});
