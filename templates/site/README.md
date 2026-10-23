# Site repo template

The company's site repo, ready for landing-page-harness to publish into. Copy these files into the repo that holds the site (or start a new one from them):

| File | What it does |
|---|---|
| `lph.json` | Where pages, their sources and the form endpoint go, and the live site's origin. Set `origin` to your domain. |
| `.github/workflows/landing-pages.yml` | On every pull request: re-runs the publish gate on the changed pages, works out the risk from the diff, and merges copy-only changes itself. |
| `wrangler.toml` | Cloudflare Pages: serves `site/`, runs the form endpoint from `functions/`. |
| `site/` | The site itself. Pages are published next to it, at `/<slug>`. |

The studio writes `site/<slug>.html` (and one file per persona version), `.lph/pages/<slug>.json`, its block in `site/_headers`, and the form endpoint in `functions/`. Edit pages in the studio rather than here: CI compares the HTML with the page's source and sends hand edits to a reviewer.

## Setup

1. In `lph.json`, set `origin` to the live site, e.g. `https://www.example.com`.
2. In the workflow, pin the harness checkout's `ref` to a commit you've reviewed.
3. Create the labels `lph:content` and `lph:needs-review`.
4. Settings → General: turn on **Allow auto-merge**.
5. Add a branch rule for `main` that requires the **check** status. If it also requires an approval, copy-only pull requests wait for a reviewer's click: the workflow never approves.
6. Connect the repo to Cloudflare Pages so every branch gets a preview at `https://<branch>.<project>.pages.dev`, and set the studio's `LPH_PREVIEW_URL` to `https://{branch}.<project>.pages.dev`.
7. Give the studio a fine-grained token for this repo only, with **Contents** and **Pull requests** read and write (`LPH_GITHUB_REPO`, `LPH_GITHUB_TOKEN`).

Form secrets live in Cloudflare, never in the repo:

```bash
npx wrangler pages secret put HUBSPOT_ACCESS_TOKEN   # HubSpot private app token (optional)
npx wrangler pages secret put LPH_WEBHOOK_SECRET     # signs webhook posts (optional)
```

Everything else is in the harness's [publishing guide](https://github.com/tywiththewifi/landing-page-harness/blob/main/docs/publish.md).
