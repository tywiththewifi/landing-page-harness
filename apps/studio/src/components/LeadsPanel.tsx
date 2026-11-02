import { useCallback, useEffect, useState } from "react";
import { CONNECTORS, type FormSettings, type Page } from "@lph/page/browser";
import { api, DEMO, type Lead } from "../api.ts";
import { TextField } from "./Fields.tsx";
import styles from "./LeadsPanel.module.scss";

const CONNECTOR_TEXT: Record<FormSettings["connector"], [string, string]> = {
  none: ["Test mode", "Sign-ups are saved here so you can try the form. They aren't sent anywhere."],
  hubspot: ["HubSpot", "Each sign-up goes to a form in your HubSpot account, just as if it was filled in on your website."],
  webhook: ["Webhook", "Each sign-up is sent to a web address you choose, for tools like Zapier, Make or n8n."],
};

/** Where the page's form sends leads, and the leads it has received. */
export function LeadsPanel({ page, update }: { page: Page; update: (fn: (draft: Page) => void) => void }) {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasForm = page.blocks.some((b) => b.type === "form");
  const { form } = page;
  const set = (patch: Partial<FormSettings>) => update((d) => void Object.assign(d.form, patch));

  const load = useCallback(() => api.leads(page.id).then(setLeads, (e: Error) => setError(e.message)), [page.id]);
  useEffect(() => {
    if (!DEMO) void load();
  }, [load]);

  return (
    <div className={styles.wrap}>
      <section className={styles.panel} aria-labelledby="leads-where">
        <h2 id="leads-where">Where leads go</h2>
        {hasForm ? null : <p className={styles.warn}>This page has no form yet. Add a Sign-up form section in the editor to collect leads.</p>}
        <div className={styles.options} role="radiogroup" aria-label="Where leads go">
          {CONNECTORS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={form.connector === c} className={form.connector === c ? styles.on : undefined} onClick={() => set({ connector: c })}>
              <strong>{CONNECTOR_TEXT[c][0]}</strong>
              <span>{CONNECTOR_TEXT[c][1]}</span>
            </button>
          ))}
        </div>
        {form.connector === "hubspot" ? (
          <div className={styles.fields}>
            <div className={styles.row}>
              <TextField label="HubSpot account number (Hub ID)" value={form.hubspotPortalId} placeholder="e.g. 1234567" onChange={(v) => set({ hubspotPortalId: v.trim() })} />
              <TextField label="Form ID" value={form.hubspotFormId} placeholder="The long code in the form's web address in HubSpot" onChange={(v) => set({ hubspotFormId: v.trim() })} />
            </div>
            <p className={styles.note}>
              Add the same fields to your HubSpot form as this page asks for (email, first name, company and so on). Turn off CAPTCHA on the HubSpot form, or HubSpot will
              turn the sign-ups away.
            </p>
            <details className={styles.note}>
              <summary>Details for developers</summary>
              Fields are named after HubSpot's contact properties (email, firstname, company…). With <code>HUBSPOT_ACCESS_TOKEN</code> set on the server (a private app
              token), the authenticated endpoint is used, with higher rate limits.
            </details>
          </div>
        ) : null}
        {form.connector === "webhook" ? (
          <div className={styles.fields}>
            <TextField label="Webhook address" value={form.webhookUrl} placeholder="https://hooks.example.com/leads" onChange={(v) => set({ webhookUrl: v.trim() })} />
            <p className={styles.note}>Paste the address your tool gives you for receiving data. It has to start with https://.</p>
            <details className={styles.note}>
              <summary>Details for developers</summary>
              Posts <code>{"{ type: \"lead\", id, pageId, variant, submittedAt, fields, context }"}</code>. With <code>LPH_WEBHOOK_SECRET</code> set on the server, each post
              carries <code>x-lph-signature: t=…,v1=…</code>, an HMAC-SHA256 of <code>t.body</code>; <code>verifyWebhook</code> in <code>@lph/forms</code> checks it.
            </details>
          </div>
        ) : null}
      </section>

      <section className={styles.panel} aria-labelledby="leads-recent">
        <div className={styles.head}>
          <h2 id="leads-recent">Recent leads</h2>
          {DEMO ? null : (
            <button type="button" className="ui-button ui-button--small" onClick={() => void load()}>
              Refresh
            </button>
          )}
        </div>
        {DEMO ? (
          <p className={styles.note}>The demo runs in your browser, so its preview form shows the thank-you message without sending anything.</p>
        ) : error ? (
          <p className={styles.warn}>{error}</p>
        ) : !leads ? (
          <p className={styles.note}>Loading…</p>
        ) : !leads.length ? (
          <p className={styles.note}>No leads yet. Submit the form in the preview to try it.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Received</th>
                <th scope="col">Email</th>
                <th scope="col">Version</th>
                <th scope="col">Came from</th>
                <th scope="col">Sent?</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id}>
                  <td>{new Date(l.receivedAt).toLocaleString()}</td>
                  <td>{l.values.email ?? l.values.phone ?? "–"}</td>
                  <td>{l.context.variant ?? "General"}</td>
                  <td>{l.context.utm.utm_source ?? "–"}</td>
                  <td>
                    <span className={styles[`status-${l.delivery.status}`]}>{{ sent: "Sent", stored: "Kept (test mode)", failed: "Failed" }[l.delivery.status]}</span>
                    {l.delivery.detail ? <span className={styles.detail}>{l.delivery.detail}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
