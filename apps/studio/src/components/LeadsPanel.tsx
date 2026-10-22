import { useCallback, useEffect, useState } from "react";
import { CONNECTORS, type FormSettings, type Page } from "@lph/page/browser";
import { api, DEMO, type Lead } from "../api.ts";
import { TextField } from "./Fields.tsx";
import styles from "./LeadsPanel.module.scss";

const CONNECTOR_TEXT: Record<FormSettings["connector"], [string, string]> = {
  none: ["Test mode", "Leads are kept in the studio so you can try the form. Nothing leaves it."],
  hubspot: ["HubSpot", "Each lead is submitted to a HubSpot form, as if it were filled in on your site, with the visitor's tracking cookie and page."],
  webhook: ["Webhook", "Each lead is posted as JSON to your URL (Zapier, Make, n8n, your own API), signed so you can check it came from here."],
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
        {hasForm ? null : <p className={styles.warn}>This page has no form section yet. Add a Lead form in the editor to collect leads.</p>}
        <div className={styles.options} role="radiogroup" aria-label="Form connector">
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
              <TextField label="Portal ID" value={form.hubspotPortalId} placeholder="e.g. 1234567" onChange={(v) => set({ hubspotPortalId: v.trim() })} />
              <TextField label="Form ID" value={form.hubspotFormId} placeholder="The GUID in the form editor's URL" onChange={(v) => set({ hubspotFormId: v.trim() })} />
            </div>
            <p className={styles.note}>
              Fields are named after HubSpot's contact properties (email, firstname, company…), so add the same fields to the HubSpot form. Turn off CAPTCHA on it: HubSpot
              refuses API submissions to forms with CAPTCHA. With <code>HUBSPOT_ACCESS_TOKEN</code> set on the server (a private app token), the authenticated endpoint is
              used, with higher rate limits.
            </p>
          </div>
        ) : null}
        {form.connector === "webhook" ? (
          <div className={styles.fields}>
            <TextField label="Webhook URL" value={form.webhookUrl} placeholder="https://hooks.example.com/leads" onChange={(v) => set({ webhookUrl: v.trim() })} />
            <p className={styles.note}>
              Posts <code>{"{ type: \"lead\", id, pageId, variant, submittedAt, fields, context }"}</code>. With <code>LPH_WEBHOOK_SECRET</code> set on the server, each post
              carries <code>x-lph-signature: t=…,v1=…</code>, an HMAC-SHA256 of <code>t.body</code>; <code>verifyWebhook</code> in <code>@lph/forms</code> checks it.
            </p>
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
                <th scope="col">Source</th>
                <th scope="col">Delivery</th>
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
