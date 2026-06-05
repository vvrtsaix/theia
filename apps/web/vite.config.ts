import { defineConfig } from "vite"
import solid from "vite-plugin-solid"

export default defineConfig({
  plugins: [solid()],
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
