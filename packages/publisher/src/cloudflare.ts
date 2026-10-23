import { siteFiles, type SiteConfig, type SiteFile, type SiteInput } from "./site.ts";
import { zip } from "./zip.ts";

/** The layout a self-hosted site uses: pages in site/, the form endpoint in functions/. */
export const CLOUDFLARE_SITE: Omit<SiteConfig, "origin"> = { publicDir: "site", sourceDir: ".lph/pages", functionsDir: "functions", formEndpoint: "site" };

const projectName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 58) || "landing-pages";

function readme(project: string, paths: string[]): string {
  return `# ${project}

Landing pages published by landing-page-harness, ready for Cloudflare Pages: static HTML in \`site/\`, and the form endpoint as a Pages Function in \`functions/\`.

## Deploy

\`\`\`bash
npx wrangler pages project create ${project} --production-branch main   # once
npx wrangler pages deploy
\`\`\`

Then add your domain in the Cloudflare dashboard (Workers & Pages → ${project} → Custom domains).

Pages: ${paths.map((p) => `\`${p}\``).join(", ")}.

## Where leads go

The form posts to \`/api/forms/<page id>\`, handled by \`functions/api/forms/[pageId].ts\`. Where each page's leads go is in \`functions/_lph/forms.json\`. Secrets are set on the project, never in files:

\`\`\`bash
npx wrangler pages secret put HUBSPOT_ACCESS_TOKEN   # HubSpot private app token (optional)
npx wrangler pages secret put LPH_WEBHOOK_SECRET     # signs webhook posts (optional)
\`\`\`

To keep every lead for 90 days, with what happened when it was sent on, create a KV namespace and bind it as \`LEADS\` (see \`wrangler.toml\`).

## Headers

\`site/_headers\` sets a Content Security Policy for each page: the page's one inline script is allowed by its hash, and it can post only to the form endpoint. Adding a tag manager or another script means changing it.

## Publishing changes

Publish again from the studio and redeploy. To review changes before they go live, put this folder in a GitHub repo, connect it to Cloudflare Pages, and publish from the studio as pull requests instead: each one gets a preview deploy.
`;
}

/**
 * The fallback when there's no site repo to open a pull request into: the same files
 * the publisher would commit, plus what Cloudflare Pages needs, as a folder to deploy
 * with wrangler.
 */
export async function cloudflareBundle(input: Omit<SiteInput, "config"> & { config: SiteConfig }): Promise<SiteFile[]> {
  const config = { ...input.config, ...CLOUDFLARE_SITE };
  const files = await siteFiles({ ...input, config });
  const project = projectName(input.brand.name + "-pages");
  const paths = files.filter((f) => f.kind === "page").map((f) => "/" + f.path.replace(/^site\//, "").replace(/\.html$/, ""));
  files.push(
    {
      path: "wrangler.toml",
      kind: "config",
      content: `name = "${project}"
pages_build_output_dir = "site"
compatibility_date = "2026-09-01"

# Keep every lead (optional): create a namespace with
#   npx wrangler kv namespace create LEADS
# and paste its id here.
# [[kv_namespaces]]
# binding = "LEADS"
# id = ""
`,
    },
    { path: "lph.json", kind: "config", content: `${JSON.stringify({ origin: config.origin, publicDir: config.publicDir, sourceDir: config.sourceDir, functionsDir: config.functionsDir }, null, 2)}\n` },
    { path: "README.md", kind: "config", content: readme(project, paths) },
  );
  return files;
}

export async function cloudflareZip(input: Parameters<typeof cloudflareBundle>[0]): Promise<Uint8Array<ArrayBuffer>> {
  return zip(await cloudflareBundle(input));
}
