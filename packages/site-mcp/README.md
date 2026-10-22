# @lph/site-mcp (prototype)

Give any public website an MCP server, so an agent can search and read it the way it would read a site that ships its own (like `api.genki.world/mcp`).

It is two steps, so the site is crawled once and served many times:

```bash
# 1. Crawl politely into a snapshot (robots.txt, then the sitemap)
pnpm site-mcp crawl https://www.kraken.tech --out sites/kraken.json

# Optional: the measured brand kit from phase 1
pnpm extract https://www.kraken.tech --out brands/kraken

# 2. Serve it over stdio
pnpm site-mcp serve sites/kraken.json --brand brands/kraken

# ...or by URL, over streamable HTTP at http://127.0.0.1:8788/mcp
pnpm site-mcp serve sites/kraken.json --brand brands/kraken --http 8788
```

Claude Code: `claude mcp add kraken -- pnpm --dir /path/to/landing-page-harness site-mcp serve sites/kraken.json --brand brands/kraken`

## Tools

Every tool is annotated `readOnlyHint: true`, so clients that only call read-only tools (like the harness's own site MCP client) can use them.

| Tool | Returns |
|---|---|
| `site_overview` | Page counts by type and language, crawl date, what was skipped and why |
| `search_site` | BM25 keyword search with snippets, filterable by page type and language |
| `list_pages` | Pages by type, language or path prefix |
| `get_page` | One page as Markdown (main content only), with its key figures and last-modified date |
| `list_case_studies` | Customer, summary and headline figures for each case study |
| `get_brand` | `DESIGN.md`, `tokens.css` or `tokens.json` from the brand import (only with `--brand`) |

## How it reads a site

- **Discovery:** `robots.txt` sitemaps (and sitemap indexes), else `/sitemap.xml`, else links from the home page. One host only.
- **Politeness:** honours `Disallow`/`Allow` (longest match, wildcards), `Crawl-delay`, `noindex`; identifies itself with a user agent that links here; 2 requests at a time with a delay.
- **Content:** prefers `<main>`, drops the site header, navigation, footer, cookie banners and mobile-only duplicate text, and converts the rest to Markdown. JSON-LD is kept when present.
- **Page types:** from URL patterns (`/case-studies/`, `/press-releases/`, `/marketplace/`, ...). Pages the home page links to that match no pattern count as products.
- **Duplicates:** pages whose text matches a shorter path (untranslated language copies) are skipped.

## Limits of the prototype

- Plain HTTP fetch, no JavaScript. Fine for server-rendered sites (Next.js, Webflow, WordPress); a client-rendered SPA needs the Playwright path the brand import already uses.
- Keyword search, not semantic. Enough for a few hundred pages; add embeddings for larger sites or conceptual questions.
- Snapshots go stale. Re-crawl on a schedule, or only pages whose sitemap `lastmod` changed.
- Read-only by design. Forms, demo requests and anything behind a login are out of scope.
