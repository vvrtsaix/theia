import { CurrentSession } from "@theia/db"
import { Errors, type TenantId } from "@theia/domain"
import { Effect } from "effect"

/**
 * The session's `activeOrganizationId` is branded `OrganizationId` (auth side
 * identity). Domain errors carry the *same* value branded as `TenantId`. They
 * refer to the same Pg row — cast at the boundary.
 */
export const sessionTenantId = Effect.gen(function* () {
  const session = yield* CurrentSession
  return session.activeOrganizationId as unknown as TenantId
})

/**
 * Lift a thrown JS Error from inside a Drizzle promise into a domain
 * `InfrastructureError`. The Drizzle/Pg layer surfaces query errors as
 * thrown promise rejections; wrap them at the handler boundary.
 */
export const intoInfra = (component: string) => (e: unknown) =>
  new Errors.InfrastructureError({ component, message: String(e) })
