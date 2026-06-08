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
 * Phase 6.x can swap in `@effect/atom-solid` for true reactive session
 * bindings; until then this hoisted singleton bounds the request count to
 * one per refresh.
 */
type SessionResource = Resource<Awaited<ReturnType<typeof authClient.getSession>>>

let sharedSession: SessionResource | undefined

const ensureShared = (): SessionResource => {
  if (sharedSession) return sharedSession
  createRoot(() => {
    const [session] = createResource(() => authClient.getSession())
    sharedSession = session
  })
  return sharedSession as SessionResource
}

export const useSession = (): SessionResource => ensureShared()

export const useUser = () => {
  const session = useSession()
  return () => session()?.data?.user ?? null
}

export const useActiveOrganizationId = () => {
  const session = useSession()
  return () => session()?.data?.session?.activeOrganizationId ?? null
}
