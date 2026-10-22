/** A compact OpenAPI description so any agent or tool can discover the API. */
const brandId = { name: "id", in: "path", required: true, schema: { type: "string" } };
const ok = (description: string, type = "application/json") => ({ 200: { description, content: { [type]: {} } } });

export const openApi = {
  openapi: "3.1.0",
  info: {
    title: "landing-page-harness API",
    version: "0.1.0",
    description:
      "Import a website's design system from its rendered CSS, review it, and export tokens, Design.md and starter components. Then turn a prompt into a marketing brief grounded in the site's own copy. Values are always measured and claims always sourced, never invented.",
  },
  paths: {
    "/api/brands": {
      get: { summary: "List imported brands", responses: ok("Brand summaries") },
      post: {
        summary: "Import a brand from a URL (home page + main product page)",
        parameters: [{ name: "wait", in: "query", schema: { type: "boolean" }, description: "Block until extraction finishes and return the brand" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["url"],
                properties: {
                  url: { type: "string", format: "uri" },
                  productUrl: { type: "string", format: "uri", description: "Defaults to the most product-like link in the header" },
                },
              },
            },
          },
        },
        responses: { 202: { description: "Job started" }, 201: { description: "Brand (when wait=true)" } },
      },
    },
    "/api/jobs/{id}": { get: { summary: "Import job status", parameters: [brandId], responses: ok("Job") } },
    "/api/brands/{id}": {
      get: { summary: "Full brand: tokens with sources, confidence, conflicts and rules", parameters: [brandId], responses: ok("Brand") },
      put: { summary: "Save edits from the Theme tab", parameters: [brandId], responses: ok("Brand") },
    },
    "/api/brands/{id}/conflicts/{conflictId}": {
      post: { summary: "Resolve a conflict by choosing one of its options", parameters: [brandId], responses: ok("Brand") },
    },
    "/api/brands/{id}/retry": { post: { summary: "Re-sample the same pages", parameters: [brandId], responses: { 202: { description: "Job started" } } } },
    "/api/brands/{id}/tokens.css": { get: { summary: "CSS custom properties", parameters: [brandId], responses: ok("CSS", "text/css") } },
    "/api/brands/{id}/tokens.json": { get: { summary: "W3C DTCG design tokens", parameters: [brandId], responses: ok("Tokens") } },
    "/api/brands/{id}/design.md": { get: { summary: "Design.md for agents", parameters: [brandId], responses: ok("Markdown", "text/markdown") } },
    "/api/brands/{id}/contrast": { get: { summary: "WCAG contrast checks", parameters: [brandId], responses: ok("Checks") } },
    "/api/brands/{id}/preview.html": { get: { summary: "Starter components rendered with the brand", parameters: [brandId], responses: ok("HTML", "text/html") } },
    "/api/brands/{id}/confirm": { post: { summary: "Write the brand kit to the output directory", parameters: [brandId], responses: ok("Written files") } },
    "/api/brands/{id}/site-mcp": {
      post: {
        summary: "Connect the site's own MCP server. Lists its tools and which read-only ones briefs will call",
        parameters: [brandId],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["url"],
                properties: {
                  url: { type: "string", format: "uri" },
                  allowed: { type: "array", items: { type: "string" }, description: "Tools to call although the server doesn't mark them read-only" },
                },
              },
            },
          },
        },
        responses: ok("Brand, with siteMcp"),
      },
      patch: {
        summary: "Change which tools not marked read-only may be called",
        parameters: [brandId],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["allowed"], properties: { allowed: { type: "array", items: { type: "string" } } } } } } },
        responses: ok("Brand, with siteMcp"),
      },
      delete: { summary: "Disconnect the site's MCP server", parameters: [brandId], responses: ok("Brand") },
    },
    "/api/seo/providers": { get: { summary: "SEO/AEO data sources: best practices, plus any connected tool", responses: ok("Providers") } },
    "/api/generator": { get: { summary: "Which brief writer the server uses (Claude or the offline template)", responses: ok("Generator") } },
    "/api/brands/{id}/briefs": {
      get: { summary: "Briefs written for this brand", parameters: [brandId], responses: ok("Brief summaries") },
      post: {
        summary: "Turn a prompt into a marketing brief grounded in the brand's site",
        parameters: [brandId, { name: "wait", in: "query", schema: { type: "boolean" }, description: "Block until the brief is written and return it" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["prompt"],
                properties: {
                  prompt: { type: "string", description: "The page or campaign, e.g. 'Landing page for our HubSpot integration for ops managers'" },
                  seoProvider: { type: "string", description: "An id from /api/seo/providers. Defaults to the connected tool, else best practices" },
                  useSiteData: { type: "boolean", description: "Read the site's MCP server first (default true when one is connected)" },
                },
              },
            },
          },
        },
        responses: { 202: { description: "Job started" }, 201: { description: "Brief (when wait=true)" } },
      },
    },
    "/api/briefs/{id}": {
      get: { summary: "Full brief: objective, personas, funnel stage, channels, messages, offer, proof, outline, SEO/AEO", parameters: [brandId], responses: ok("Brief") },
      put: { summary: "Save edits to the brief", parameters: [brandId], responses: ok("Brief") },
    },
    "/api/briefs/{id}/check": { get: { summary: "Consistency check against the site, the funnel and SEO/AEO rules", parameters: [brandId], responses: ok("Issues") } },
    "/api/briefs/{id}/brief.md": { get: { summary: "The brief as Markdown", parameters: [brandId], responses: ok("Markdown", "text/markdown") } },
  },
} as const;
