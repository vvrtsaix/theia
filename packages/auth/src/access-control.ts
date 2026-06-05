import { createAccessControl } from "better-auth/plugins/access"
import {
  adminAc as orgAdminAc,
  defaultStatements as orgDefaultStatements,
  memberAc as orgMemberAc,
  ownerAc as orgOwnerAc,
} from "better-auth/plugins/organization/access"
import { Entities } from "@theia/domain"

/**
 * Domain → better-auth statement bridge.
 *
 * The domain owns the resource/action shape (`PermissionStatement` in
 * `@theia/domain/entities/Permission.ts`). This file wires it into a
 * better-auth `AccessController` and pre-defines four built-in roles. Any
 * additional tenant-specific roles are stored in `organization_role` table
 * via `dynamicAccessControl` and created at runtime by tenant admins.
 *
 * Source of truth for resource keys: `Entities.PermissionStatement`. If a
 * domain key changes here without a corresponding RPC permission gate
 * update, CI fails.
 */

export const statement = {
  ...orgDefaultStatements,
  ...Entities.PermissionStatement,
} as const

export const ac = createAccessControl(statement)

// ────────────────────────────────────────────────────────────────────────────
// Built-in roles
// ────────────────────────────────────────────────────────────────────────────

/** Tenant owner — full control over every domain resource + org actions. */
export const owner = ac.newRole({
  ...orgOwnerAc.statements,
  ticket: [...Entities.PermissionStatement.ticket],
  comment: [...Entities.PermissionStatement.comment],
  workflow: [...Entities.PermissionStatement.workflow],
  tenant: [...Entities.PermissionStatement.tenant],
  member: [...Entities.PermissionStatement.member],
  role: [...Entities.PermissionStatement.role],
})

/** Tenant admin — everything except deleting/transferring the tenant. */
export const admin = ac.newRole({
  ...orgAdminAc.statements,
  ticket: [...Entities.PermissionStatement.ticket],
  comment: [...Entities.PermissionStatement.comment],
  workflow: ["read", "update"],
  tenant: ["read", "update"],
  member: ["read", "list", "invite", "update"],
  role: ["create", "read", "list", "update", "delete"],
})

/** Internal agent — handles tickets but cannot configure workflow or invite. */
export const agent = ac.newRole({
  ...orgMemberAc.statements,
  ticket: ["read", "list", "update", "transition", "assign", "comment"],
  comment: ["create"],
  workflow: ["read"],
  member: ["read", "list"],
})

/** Customer — can only open/comment on tickets, cannot see others' tickets. */
export const customer = ac.newRole({
  ticket: ["create", "read", "comment"],
  comment: ["create"],
  workflow: ["read"],
})

/** Used by better-auth's `roles` config below. */
export const roles = { owner, admin, agent, customer } as const
