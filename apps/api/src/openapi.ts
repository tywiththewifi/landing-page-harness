/** A compact OpenAPI description so any agent or tool can discover the API. */
const brandId = { name: "id", in: "path", required: true, schema: { type: "string" } };
const ok = (description: string, type = "application/json") => ({ 200: { description, content: { [type]: {} } } });

export const openApi = {
  openapi: "3.1.0",
  info: {
    title: "landing-page-harness API",
    version: "0.1.0",
    description:
      "Import a website's design system from its rendered CSS, review it, and export tokens, Design.md and starter components. Values are always measured, never invented.",
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
  },
} as const;
