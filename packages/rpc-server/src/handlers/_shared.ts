import { CurrentSession } from "@theia/db"
import { Errors, type TenantId, type UserId } from "@theia/domain"
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

/**
 * Extract `@handle` mentions from free-form text. Returns the raw handle
 * strings (without `@`). Skips email-internal `@` by requiring word-class
 * start (`^` or whitespace) before the marker.
 *
 *   "hello @alice and @bob.smith"  → ["alice", "bob.smith"]
 *   "ping <a@example.com> for now" → []  // no leading boundary
 */
export const parseMentionHandles = (body: string): ReadonlyArray<string> =>
  Array.from(body.matchAll(/(?:^|\s)@([\w.-]+)/g))
    .map((m) => m[1])
    .filter((h): h is string => Boolean(h))

/** Lowercase + strip separators for case/punctuation-insensitive comparison. */
const normalizeHandle = (s: string) => s.toLowerCase().replace(/[\s_.-]/g, "")

/**
 * Resolve `@handle` strings to UserIds within the active tenant. A handle
 * matches a member when the lowercased + stripped form equals the lowercased
 * + stripped `name`, email local part, or full email.
 *
 * Unknown handles are silently dropped — non-members can't be mentioned.
 */
export const resolveMentions = (
  handles: ReadonlyArray<string>,
  members: ReadonlyArray<{ readonly id: string; readonly name: string; readonly email: string }>,
): ReadonlyArray<UserId> => {
  if (handles.length === 0) return []
  const handleSet = new Set(handles.map(normalizeHandle))
  const out: Array<UserId> = []
  for (const m of members) {
    const local = m.email.split("@")[0] ?? ""
    if (
      handleSet.has(normalizeHandle(m.name)) ||
      handleSet.has(normalizeHandle(local)) ||
      handleSet.has(normalizeHandle(m.email))
    ) {
      out.push(m.id as UserId)
    }
  }
  return out
}
