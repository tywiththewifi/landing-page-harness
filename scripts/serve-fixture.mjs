// Serves a fixture site (default: fixtures/northloop) for local runs and tests.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TYPES = { ".html": "text/html", ".css": "text/css", ".svg": "image/svg+xml", ".js": "text/javascript" };

export function serveFixture({ name = "northloop", port = 0 } = {}) {
  const root = resolve(fileURLToPath(new URL("../fixtures/", import.meta.url)), name);
  const server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    const rel = normalize(pathname.endsWith("/") ? pathname + "index.html" : pathname).replace(/^(\.\.[/\\])+/, "");
    try {
      const body = await readFile(join(root, rel));
      res.writeHead(200, { "content-type": TYPES[extname(rel)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("Not found");
    }
  });
  return new Promise((ok) =>
    server.listen(port, "127.0.0.1", () => {
      const { port: p } = server.address();
      ok({ url: `http://127.0.0.1:${p}/`, close: () => new Promise((done) => server.close(done)) });
    }),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { url } = await serveFixture({ port: Number(process.env.PORT ?? 4319) });
  console.log(`Fixture site at ${url}`);
}
