import { createResource } from "solid-js"
import { authClient } from "#auth/client"

/**
 * Resource-based session accessor. better-auth's reactive `useSession` lives
 * in their Atom layer; for v0 we poll `getSession()` once on mount — Phase
 * 6.x can swap for the reactive Atom binding.
 */
export const useSession = () => {
  const [session] = createResource(() => authClient.getSession())
  return session
}

export const useUser = () => {
  const session = useSession()
  return () => session()?.data?.user ?? null
}

export const useActiveOrganizationId = () => {
  const session = useSession()
  return () => session()?.data?.session?.activeOrganizationId ?? null
}
