# Trying it on any site: `pnpm try` and the MCP server

Two ways to run a website through every phase without the studio: a command for people, and an MCP server for agents (Claude Desktop, Claude Code, Cursor or any MCP client). Both use the same API and the same code as the studio.

## Setup

```bash
pnpm install
pnpm --filter @lph/extractor exec playwright install chromium
```

Set `ANTHROPIC_API_KEY` for Claude-written briefs and page copy. Without it, the offline writer fills the structure from the site's own copy and leaves `[To write]` where only a person (or a model) could know, so the publish checks will say **blocked** until that copy is written. That's expected: it shows the guardrail working.

## `pnpm try`

```bash
pnpm try stripe.com
pnpm try linear.app --prompt "Landing page for Linear Insights for engineering managers"
pnpm try webflow.com qonto.com posthog.com        # several sites, with a summary table at the end
pnpm try example.com --product https://example.com/platform --no-gate
```

Each site gets a folder under `runs/` with:

| File | What |
|---|---|
| `report.md` | What each step found: the brand (colours, fonts, buttons, conflicts), the brief and page checks, and the publish gate's verdict per check |
| `report.json` | The same, for scripts |
| `brand-preview.html`, `DESIGN.md`, `tokens.css` | The brand kit |
| `brief.md` | The brief |
| `page.html`, `page-<persona>.html` | The page and each persona's version, as they'd be published |

A run stops at the first step that fails and says why, so a site that can't be imported (a bot check, a timeout) ends with a report, not a stack trace. Without `--prompt`, the brief is for a landing page about the brand itself.

## The MCP server

```bash
pnpm --silent mcp
```

It speaks MCP over stdio. With `LPH_API_URL` set it uses that API; otherwise it starts the API in its own process on localhost (`LPH_PORT`, or a free port), so the preview links it returns open in a browser while it runs. It reads the same settings as the API (see [.env.example](../.env.example)).

### Claude Code

```bash
claude mcp add softlander -e ANTHROPIC_API_KEY=sk-... -- pnpm --silent --dir /path/to/landing-page-harness mcp
```

### Claude Desktop, Cursor and others

```json
{
  "mcpServers": {
    "softlander": {
      "command": "pnpm",
      "args": ["--silent", "--dir", "/path/to/landing-page-harness", "mcp"],
      "env": { "ANTHROPIC_API_KEY": "sk-..." }
    }
  }
}
```

Then ask: *"Try Softlander on qonto.com and tell me what it found."*

### Tools

| Tool | Does |
|---|---|
| `launch_from_url` | Everything below in one call: import, brief, page, checks. Returns the report and the ids |
| `import_brand` | Measures a site's design system (15 to 30 seconds) |
| `list_brands`, `get_brand` | A brand as a summary, `DESIGN.md`, `tokens.css`, `tokens.json`, contrast checks or the full record |
| `resolve_conflict` | Picks one of a conflict's measured options |
| `write_brief`, `get_brief`, `update_brief` | The brief, its check, and edits to it |
| `build_page`, `get_page`, `update_page` | The page (summary, record or published HTML), and constrained edits |
| `run_checks` | The publish gate: content, brand, SEO/AEO, axe and performance |
| `publish_plan`, `publish_page` | What publishing would do, then the pull request (needs a site repo on the server). `overrideReason` publishes over errors when the person asks for it |

Each brand's `DESIGN.md` and `tokens.css` are also resources (`lph://brands/{id}/design.md`), so a client can attach them to a conversation.

An agent can close the loop: read a check's errors, fix the copy with `update_page`, run the checks again. The tools keep Softlander's rules: values come from the site, numbers and quotes need a source, and publishing needs a gate with no errors, unless the person chooses to publish anyway and says why.

## Results from random sites

Thirteen sites run while building this (October 2026), with the offline writer. "Content" always blocks because the offline writer leaves `[To write]` copy for a person; the other checks are about what Softlander built from the brand, and none of them has an error.

| Site | Import | Brand, SEO, accessibility, performance on the generated page |
|---|---|---|
| webflow.com | Webflow blue `#146ef5`, WF Visual Sans, 3 button styles | Pass, one brand warning (no button stands out on the blue hero) |
| alan.com | AlanSans, sky and blue, 3 button styles | Pass |
| qonto.com | QontoSans, monochrome, 5 button styles | Pass |
| vercel.com | Geist, black and white pills | Pass |
| posthog.com | RoundHog, 4 button styles | Pass; warnings for the hero button and page weight |
| backmarket.fr | BMDuplet display and text faces (flagged as a conflict to pick) | Pass |
| swile.co | swileNova and Graphik, black buttons | Pass |
| framer.com | Dark, Inter | Pass; warning that Inter isn't loaded on the page |
| pennylane.com | Unica77, teal | Pass, one brand warning (hero button) |
| lemonde.fr | The Antiqua and Marr Sans, blue and yellow | Pass |
| linear.app | Dark, Inter | Pass; warnings for the hero button and fonts not loaded |
| doctolib.fr, malt.fr | Stopped: Cloudflare bot check | – |

What these runs found and fixed is in the pull request that added this page. Still open:

- **Bot checks.** Sites behind Cloudflare, DataDome and the like show a check to headless browsers. The import stops with a clear message instead of measuring the check page; importing them needs a browser that has passed the check.
- **Buttons over photos and video.** A white button over a hero image reads as white on white, because the background behind it is an image. Such a button is only found if the site uses the same style elsewhere (Qonto's is, on its product page).
- **Product page.** Sites whose header links are all in menus (Alan, Back Market, Pennylane) are sampled from the home page only. Pass `--product` (or `productUrl`) to add one.
- **Fonts from other origins.** Framer's and Linear's fonts load from stylesheets the preview can't reuse, so the generated page falls back and the brand check warns. Framer's body font is read as the generic `sans-serif`.
- **The hero button.** On a brand-coloured hero, sites whose buttons are all the brand colour (Webflow's blue on blue) have nothing that stands out; the brand check says so rather than inventing a style.
- **Behind an HTTP proxy**, the importer's private-address check sees the proxy's address for every request and refuses the import. Set `LPH_ALLOW_PRIVATE_URLS=1` only on a machine where that's safe (your own laptop, not a public service).
