# Connecting an SEO or AEO tool

Briefs use keyword and question data from whatever tool a team already pays for. Instead of one integration per vendor, the API calls **one HTTP endpoint** that you control. Put a small function, a Zapier or n8n flow, or an internal service in front of Semrush, Ahrefs, Search Console, DataForSEO or anything else, and have it answer in the format below.

With nothing connected, briefs follow general search and answer-engine practice, and the brief says its keywords need validating.

## Configure

Set these on the API server (see `.env.example`):

```bash
LPH_SEO_ENDPOINT=https://example.com/seo-research   # required
LPH_SEO_NAME=Semrush                                # shown in the studio
LPH_SEO_TOKEN=...                                   # sent as "Authorization: Bearer <token>"
```

The connected tool becomes the default for new briefs. People can still pick "Best practices" in the studio. If the endpoint fails or takes longer than 20 seconds, the brief falls back to best practices and records why.

## Request

`POST` with a JSON body:

```json
{
  "topic": "Landing page for our new HubSpot integration for ops managers",
  "siteUrl": "https://northloop.com/",
  "lang": "en"
}
```

`topic` is the marketer's request as typed. Most tools want a seed keyword, so the endpoint can extract one or pass the topic to the tool's own keyword ideas.

## Response

```json
{
  "keywords": [
    { "term": "hubspot workflow automation", "volume": 880, "difficulty": 31, "intent": "commercial" },
    { "term": "hubspot ops automation", "volume": 210 },
    "hubspot integration for ops"
  ],
  "questions": [
    "How do I automate HubSpot workflows?",
    "Does HubSpot integrate with Stripe?"
  ],
  "notes": ["Volumes are US, last 12 months."]
}
```

- `keywords`: up to 50, most relevant first. Each is a string or an object; `volume`, `difficulty` and `intent` are optional.
- `questions`: what people ask search and answer engines (People Also Ask, Search Console queries phrased as questions, AlsoAsked).
- `notes`: anything the brief should mention about the data.

Anything else in the response is ignored, and malformed entries are dropped.

## In code

The same interface is available to anyone embedding the packages:

```ts
import { httpProvider, type SeoProvider } from "@lph/brief";

const semrush = httpProvider({ name: "Semrush", url: process.env.SEMRUSH_PROXY!, token: process.env.SEMRUSH_PROXY_TOKEN });

// Or implement the interface directly
const custom: SeoProvider = {
  id: "gsc",
  name: "Search Console",
  description: "Queries the site already ranks for.",
  async research({ topic, siteUrl }) {
    return { provider: "gsc", keywords: [], questions: [], notes: [] };
  },
};
```

Pass providers to `createApp({ seoProviders: [...] })`.
