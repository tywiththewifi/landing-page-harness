import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": process.env.LPH_API_URL ?? "http://localhost:8787" },
  },
  // `pnpm build:demo`: a static build that runs without the API (see src/demo/api.ts).
  ...(mode === "demo" && {
    base: "./",
    build: { outDir: "dist-demo", rolldownOptions: { input: "demo.html" } },
  }),
}));
