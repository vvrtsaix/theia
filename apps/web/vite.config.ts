import { fileURLToPath } from "node:url"
import tailwind from "@tailwindcss/vite"
import { defineConfig } from "vite"
import solid from "vite-plugin-solid"

/**
 * Resolve the workspace root so Vite reads `.env*` files from the repo root
 * instead of `apps/web/`. Keeps a single source of truth for env config
 * across both api (Bun) and web (Vite). Only `VITE_*` keys are exposed to
 * client code; other vars stay server-side, which is what we want.
 */
const WORKSPACE_ROOT = fileURLToPath(new URL("../..", import.meta.url))

export default defineConfig({
  envDir: WORKSPACE_ROOT,
  // `@tailwindcss/vite` is required for Tailwind v4. The bare `@import
  // "tailwindcss"` directive only emits preflight + custom CSS without it —
  // utility classes never get generated.
  plugins: [tailwind(), solid()],
  server: {
    port: 5173,
    proxy: {
      // Forward API + better-auth handler to the Effect backend in dev.
      "/api": "http://localhost:3000",
      "/rpc": "http://localhost:3000",
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
})
