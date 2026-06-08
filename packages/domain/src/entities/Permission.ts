import { Schema } from "effect"

/**
 * The Permission statement — resource × action shape that drives authorization.
 *
 * Mirrors better-auth's `createAccessControl(statement)` input. Tenant roles
 * (stored via better-auth `dynamicAccessControl`) reference these resource keys
 * and action names; `auth.api.hasPermission({ permissions: { <resource>: [<actions>] } })`
 * checks the active member's role against this statement at request time.
 *
 * Domain owns the statement so changes are reviewed alongside RPC contracts —
 * if you add a new resource here, the matching RPC + handler must follow in
 * the same domain PR.
 */

export const Resource = Schema.Literals([
  "ticket",
  "comment",
  "workflow",
  "tenant",
  "member",
  "role",
])
export type Resource = typeof Resource.Type

/** Closed set of universally applicable actions. Resource-specific verbs are layered on per resource. */
export const Action = Schema.Literals([
  "create",
  "read",
  "update",
  "delete",
  "list",
  "transition",
  "assign",
  "comment",
  "invite",
])
export type Action = typeof Action.Type

/**
 * The authoritative statement used by better-auth's access controller.
 *
 * Keep this aligned with `Resource` / `Action`. Roles in DB reference these
 * exact keys; renaming a resource is a breaking change requiring migration.
 */
export const PermissionStatement = {
  ticket: [
    "create",
    "read",
    "list",
    "update",
    "delete",
    "transition",
    "assign",
    "comment",
  ] as const,
  comment: ["create", "delete"] as const,
  workflow: ["read", "update"] as const,
  tenant: ["read", "update", "delete"] as const,
  member: ["read", "list", "invite", "update", "delete"] as const,
  role: ["create", "read", "list", "update", "delete"] as const,
} as const

export type PermissionStatement = typeof PermissionStatement

/** Single permission check — for embedding in RPC payload validation or audit logs. */
export class Permission extends Schema.Class<Permission>("Permission")({
  resource: Resource,
  action: Action,
}) {}
