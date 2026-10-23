import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { nodeApp } from "@lph/api/node";
import { ApiClient } from "./client.ts";

/**
 * The API to talk to: LPH_API_URL when it's set, otherwise the API started in this
 * process and served on localhost (LPH_PORT, or a free port), so preview links open.
 */
export async function connectApi(env: NodeJS.ProcessEnv = process.env): Promise<{ api: ApiClient; summary: string[]; close: () => Promise<void> }> {
  if (env.LPH_API_URL) {
    return { api: new ApiClient(env.LPH_API_URL), summary: [`Using the API at ${env.LPH_API_URL}.`], close: async () => {} };
  }
  const { app, summary, close } = nodeApp(env);
  const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const s = serve({ fetch: app.fetch, port: Number(env.LPH_PORT ?? 0), hostname: "127.0.0.1" }, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  // Calls go straight to the app; the port is for the links people open.
  const api = new ApiClient(`http://127.0.0.1:${port}`, (r) => app.fetch(r));
  return {
    api,
    summary: [`API running in this process at ${api.base}.`, ...summary],
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await close();
    },
  };
}
