import { Schema } from "effect"
import { TenantId, UserId } from "#ids"

/**
 * Closed-set identity class. Drives auth/visibility rules at the framework
 * layer:
 *   - `customer`  → tenant-scoped customer accounts; can only see own tickets.
 *   - `internal`  → staff (agents, managers, etc.); roles assigned per tenant.
 *   - `system`    → service accounts (bots, integrations); bypass interactive auth.
 *
 * NOT user-customizable. Per-tenant labels live in `UserRole`.
 */
export const UserKind = Schema.Literals(["customer", "internal", "system"])
export type UserKind = typeof UserKind.Type

/**
 * Per-tenant role name — branded NonEmptyString. Roles + their permissions
 * are stored in DB via better-auth's `dynamicAccessControl`; tenant admins
 * can create / edit / delete roles at runtime. Permission set lives in the
 * better-auth `role` table, not here.
 *
 * The same user can hold a different role in each tenant they belong to.
 */
export const UserRole = Schema.NonEmptyString.pipe(Schema.brand("UserRole"))
export type UserRole = typeof UserRole.Type

export class User extends Schema.Class<User>("User")({
  id: UserId,
  email: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  kind: UserKind,
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
}) {}

/**
 * One row per (user, tenant) — mirrors better-auth's `Member` table. The same
 * user can have entries in multiple tenants with a different role per tenant.
 */
export class TenantMember extends Schema.Class<TenantMember>("TenantMember")({
  userId: UserId,
  tenantId: TenantId,
  role: UserRole,
  joinedAt: Schema.DateTimeUtcFromString,
}) {}
