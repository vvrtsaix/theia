import { createResource, createRoot, type Resource } from "solid-js"
import { authClient } from "#auth/client"

/**
 * Resource-based session accessor.
 *
 * The resource is created **once** inside a `createRoot` so every component
 * that reads `useSession()` shares the same `getSession()` request and the
 * same reactive value. A naïve `createResource(...)` per component fires N
 * parallel requests on every page load (Sidebar + Identity + TenantSwitcher
 * + permission hooks + page bodies each mount their own).
 *
 * `refreshSession()` re-fetches and broadcasts to every consumer — call
 * after login, logout, tenant switch, or any action that mutates session
 * state on the server. Without this, components hold stale data until next
 * full page reload.
 */
type SessionData = Awaited<ReturnType<typeof authClient.getSession>>
type SessionResource = Resource<SessionData>

let sharedSession: SessionResource | undefined
let refresh: (() => Promise<SessionData | undefined>) | undefined

const ensureShared = (): SessionResource => {
  if (sharedSession) return sharedSession
  createRoot(() => {
    const [session, { refetch }] = createResource(() => authClient.getSession())
    sharedSession = session
    refresh = refetch
  })
  return sharedSession as SessionResource
}

export const useSession = (): SessionResource => ensureShared()

export const refreshSession = (): Promise<SessionData | undefined> => {
  ensureShared()
  return refresh?.() ?? Promise.resolve(undefined)
}

export const useUser = () => {
  const session = useSession()
  return () => session()?.data?.user ?? null
}

export const useActiveOrganizationId = () => {
  const session = useSession()
  return () => session()?.data?.session?.activeOrganizationId ?? null
}
