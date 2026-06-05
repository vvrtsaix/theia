import { createAuthClient } from "better-auth/client"
import { organizationClient } from "better-auth/client/plugins"

/**
 * Browser auth client. Talks to the better-auth handler mounted at `/api/auth/*`
 * (proxied to the Effect API in dev via `vite.config.ts`).
 *
 * Use `authClient.useSession()` for the reactive session signal,
 * `authClient.signIn.email(...)` / `signUp.email(...)` for password flow, and
 * `authClient.organization.*` for tenant (org) operations.
 */
export const authClient = createAuthClient({
  baseURL:
    typeof window !== "undefined"
      ? `${window.location.protocol}//${window.location.host}`
      : "http://localhost:3000",
  plugins: [organizationClient({ dynamicAccessControl: { enabled: true } })],
})

export type AuthClient = typeof authClient
