import { createMemo, createResource } from "solid-js"
import { authClient } from "#auth/client"
import { useSession } from "#auth/session"

/**
 * Reactive permission check tied to the active tenant + member role.
 *
 * Calls `authClient.organization.hasPermission` for `(resource, action)`. The
 * resource set lives in `@theia/domain/entities/Permission.PermissionStatement`
 * — keeping the keys typed there means renames propagate through both backend
 * gates and these UI gates.
 *
 * Uses `createResource` so the result re-fetches whenever the active org
 * changes. Returns an accessor whose value is `boolean | undefined`
 * (`undefined` = still loading; we treat as "no permission" at the call site
 * to avoid flashing affordances the user cannot actually use).
 */
export const usePermission = (resource: string, action: string) => {
  const session = useSession()
  const orgId = createMemo(() => session()?.data?.session?.activeOrganizationId ?? null)
  const [allowed] = createResource(
    () => (orgId() ? { orgId: orgId()!, resource, action } : null),
    async (key) => {
      const res = await authClient.organization.hasPermission({
        organizationId: key.orgId,
        permissions: { [key.resource]: [key.action] } as never,
      })
      return res.data?.success ?? false
    },
  )
  return () => allowed() === true
}
