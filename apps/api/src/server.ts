import { serve } from "@hono/node-server";
import { nodeApp } from "./node.ts";

const port = Number(process.env.PORT ?? 8787);
const { app, summary, close } = nodeApp();

serve({ fetch: app.fetch, port }, () => {
  console.log(`API on http://localhost:${port}`);
  for (const line of summary) console.log(line);
});

const shutdown = async () => {
  await close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
