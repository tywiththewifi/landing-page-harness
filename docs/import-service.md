# Import service

The online demo runs the studio in the browser, but a browser can't open other websites or talk to their MCP servers. The import service does just those two things, so the demo can import any public site. It is `apps/api/src/public.ts`, packaged by the root `Dockerfile`.

It keeps nothing. A finished import is handed back once and then forgotten, and the brand, briefs and edits live in the visitor's browser. Northloop, the sample, never touches it.

## Endpoints

| Route | Does |
|---|---|
| `GET /api/health` | `{ ok, mode: "public", importsPerHour }`. The demo calls it on load to wake a sleeping Space. |
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

**Hugging Face (free).** Add an `HF_TOKEN` secret to the GitHub repository: a Hugging Face token with write access. On the next push to `main` that touches the service, `.github/workflows/import-service.yml` creates a Docker Space called `landing-page-harness` under that account, uploads the repo, and waits until the Space answers. The Pages build finds the Space's address the same way and builds the demo against it. To deploy without a push, run the workflow by hand from the Actions tab. Free Spaces sleep after two days without visitors and take about a minute to wake.

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
