# Import service

The online demo runs the studio in the browser, but a browser can't open other websites or talk to their MCP servers. The import service does just those two things, so the demo can import any public site. It is `apps/api/src/public.ts`, packaged by the root `Dockerfile`.

It keeps nothing. A finished import is handed back once and then forgotten, and the brand, briefs and edits live in the visitor's browser. Northloop, the sample, never touches it.

## Endpoints

| Route | Does |
|---|---|
| `GET /api/health` | `{ ok, mode: "public", importsPerHour }`. The demo calls it on load, so a sleeping service starts before anyone imports. |
| `POST /api/brands` `{ url, productUrl?, id? }` | Starts an import and returns a job (202). `id` keeps a brand's id on a re-import. |
| `GET /api/jobs/:id` | The job. When it's done, the brand comes with it, and the job is deleted. |
| `POST /api/site-mcp/inspect` `{ url, allowed }` | What the site's MCP server offers, and which tools would be called. |
| `POST /api/site-mcp/collect` `{ url, topic, allowed }` | The site data for a brief. Same rules as the full API: read-only tools only, unless a person allows one. |

## Limits

- **Per visitor:** 10 imports and 60 MCP calls an hour, by the first `x-forwarded-for` address. A visitor can forge that header, so this is a courtesy.
- **For everyone:** 200 imports an hour. This is the hard cap on what the service spends.
- **Browsers:** two imports run at once and the rest queue, with "Waiting for a free browser" as their step. An import gets 2 minutes, and each page load 30 seconds.
- **Addresses:** private and internal addresses are refused, both as the URL given and for every request the page makes. Hosts are resolved before each request, and a redirect is caught from the address that answered it. Either way, the import fails rather than returning anything from inside.

| Variable | Default |
|---|---|
| `PORT` | 7860 |
| `LPH_IMPORTS_PER_HOUR` | 10 |
| `LPH_IMPORTS_PER_HOUR_TOTAL` | 200 |
| `LPH_MCP_CALLS_PER_HOUR` | 60 |
| `LPH_MAX_CONCURRENT` | 2 |
| `LPH_CORS_ORIGINS` | any origin, comma-separated to restrict it |

## Deploying

**Cloud Run.** `.github/workflows/import-service.yml` builds the image, pushes it to Artifact Registry and deploys it to Cloud Run in `europe-west1`. It runs on every push to `main` that touches the service, or by hand from the Actions tab. The Pages build then finds the service's address and builds the demo against it.

The service runs on 2 CPUs and 2 GB, with at most one instance, because jobs live in its memory. It scales to zero when idle and takes 10 to 30 seconds to start again. CPU stays on while an instance is up, since imports run after the request that starts them. Demo traffic should stay within Cloud Run's free tier.

GitHub Actions signs in to Google Cloud with GitHub's own short-lived token (workload identity federation), so there's no service account key to create or leak. Many Google Cloud organisations block keys outright. The service is made public with `--no-invoker-iam-check`, so organisation policies that forbid `allUsers` grants don't stop it.

Setup, once:

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project. It needs a billing account. Set a budget alert of a few euros under Billing > Budgets.
2. Open Cloud Shell (the terminal icon at the top of the console) and run:

   ```bash
   curl -fsSLO https://raw.githubusercontent.com/tywiththewifi/landing-page-harness/main/scripts/gcp-setup.sh
   bash gcp-setup.sh your-project-id
   ```

   [`scripts/gcp-setup.sh`](../scripts/gcp-setup.sh) enables the APIs and creates a `github-deploy` service account with the Cloud Run Admin, Artifact Registry Administrator and Service Account User roles. It also lets this repository's workflows, and only them, sign in as that account. It's safe to run again.
3. Add the two values it prints as repository variables under Settings > Secrets and variables > Actions > Variables: `GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_SERVICE_ACCOUNT`.
4. Run the Import service workflow from the Actions tab.

**Anywhere else.** It's one container:

```bash
docker build -t lph-import .
docker run -p 7860:7860 lph-import
```

Set an `IMPORT_API` repository variable to its address, and the Pages build uses that instead.

**Locally,** against the fixture:

```bash
pnpm fixture &                                                     # Northloop on :4319
LPH_ALLOW_PRIVATE_URLS=1 PORT=7861 pnpm --filter @lph/api start:public
VITE_IMPORT_API=http://127.0.0.1:7861 pnpm --filter @lph/studio build:demo
```
