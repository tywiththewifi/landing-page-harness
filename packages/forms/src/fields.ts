/**
 * The fields a page's lead form can ask for. They are named after HubSpot's default
 * contact properties, so a submission maps onto a HubSpot form with no setup, and a
 * webhook gets the same names.
 */
export const FIELDS = {
  email: { label: "Work email", type: "email", autocomplete: "email", max: 254 },
  firstname: { label: "First name", type: "text", autocomplete: "given-name", max: 100 },
  lastname: { label: "Last name", type: "text", autocomplete: "family-name", max: 100 },
  company: { label: "Company", type: "text", autocomplete: "organization", max: 200 },
  jobtitle: { label: "Job title", type: "text", autocomplete: "organization-title", max: 200 },
  phone: { label: "Phone", type: "tel", autocomplete: "tel", max: 40 },
  website: { label: "Company website", type: "url", autocomplete: "url", max: 500 },
  message: { label: "Message", type: "textarea", autocomplete: "off", max: 5000 },
} as const;

export type FieldName = keyof typeof FIELDS;
export const FIELD_NAMES = Object.keys(FIELDS) as [FieldName, ...FieldName[]];

/** One field as a page's form block configures it. */
export interface FormFieldConfig {
  name: FieldName;
  label: string;
  required: boolean;
}

/** The hidden field bots fill in and people never see. */
export const HONEYPOT = "_hp";
