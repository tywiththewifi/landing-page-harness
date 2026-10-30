# Site data from the site's MCP server

Many companies now run an MCP server so AI agents can look up their plans, prices, help articles or product facts. If yours does, connect it on the **Plan a page** screen (or `POST /api/brands/:id/site-mcp`). Every brief can then use what it says, alongside the copy from the site's pages.

## What Softlander calls

Connecting lists the server's tools and resources and shows what will happen to each one:

| Tool | What happens |
|---|---|
| Marked read-only (`annotations.readOnlyHint: true`), no required inputs | Called as is |
| Marked read-only, one required search input (`query`, `q`, `search`, `topic`, ...) | Called with the page's topic, e.g. "HubSpot integration" |
| Needs other inputs (an id, a slug, an email) | Never called |
| Not marked read-only | Never called, unless a person ticks **Allow** for it |

A missing annotation counts as not read-only, as the MCP spec says. Only allow a tool if you know it just reads data: allowed tools are called every time a brief is written.

Text resources are read too. Answers are capped at 4,000 characters each and 20,000 in total. Redirects are refused, and the server's URL goes through the same private-address check as brand imports.

## How briefs use it

- The answers reach the brief writer as data in a `<site_data>` block, separate from its instructions.
- Proof points can cite them with the source **Site data**. The consistency check confirms the evidence is really in the answers.
- Numbers in the answers count as sourced, like numbers on the site's pages.
- Brief.md says which server was used, and the editor shows every answer under **Proof points**.
- If the server can't be reached, the brief is written from the site copy and records why.

## Not yet

- Servers that need OAuth. A bearer token is supported in code (`McpOptions.token`) but not yet configurable.
- Live values on the page itself (pricing tables that update at build time). That comes with phase 3.

## No MCP server?

The `site-mcp` prototype (draft PR #5) builds one for any public website from a crawl. Its tools are marked read-only and it serves streamable HTTP, so it can be connected here like any other server.

## Trying it locally

`pnpm fixture` serves the fictional Northloop site with an MCP server at `http://127.0.0.1:4319/mcp` (data in `fixtures/northloop/mcp.json`). It includes one tool of each kind in the table above.
