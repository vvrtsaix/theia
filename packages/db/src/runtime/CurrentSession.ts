import { Context } from "effect"
import type { OrganizationId, UserId } from "@theia/domain"
import type { UserKind, UserRole } from "@theia/domain/entities"

/**
 * Per-request session — provided by the auth middleware (Phase 3, `@theia/auth`).
 *
 * Declared here in `@theia/db` because the DB runtime needs it as a dep
 * (`Database.withTenantTx` reads `activeOrganizationId` to bind RLS). Phase 3
 * supplies the concrete implementation; downstream packages depend on this
 * type, not on the auth package directly.
 */
export class CurrentSession extends Context.Service<CurrentSession, {
  readonly userId: UserId
  /** Kind drives visibility rules — customers cannot see internal users, etc. */
  readonly userKind: UserKind
  /**
   * Active tenant. = `session.activeOrganizationId` from better-auth.
   * Used as the `app.tenant_id` GUC for RLS.
   */
  readonly activeOrganizationId: OrganizationId
  /** Role assigned to the user in the active organization. */
  readonly role: UserRole
}>()("@theia/db/CurrentSession") {}
