import { CurrentSession } from "@theia/db"
import { Entities, OrganizationId, UserId } from "@theia/domain"
import { Effect, Layer, Schema } from "effect"
import { auth } from "#auth"
import { NoActiveOrganization, SessionInvalid } from "#errors"

/**
 * Resolve the request's session via better-auth, then `provide` a
 * `CurrentSession` Effect service for handlers downstream.
 *
 * Failure modes:
 *   - cookie missing / expired      → `SessionInvalid`
 *   - session has no active org     → `NoActiveOrganization`
 *
 * The DB layer reads `CurrentSession.activeOrganizationId` inside
 * `Database.withTenantTx` to bind `app.tenant_id`.
 */
export const resolveSession = (
  headers: Headers,
): Effect.Effect<typeof CurrentSession.Service, SessionInvalid | NoActiveOrganization> =>
  Effect.gen(function* () {
    const session = yield* Effect.tryPromise({
      try: () => auth.api.getSession({ headers }),
      catch: (cause) =>
        new SessionInvalid({ reason: `auth.api.getSession threw: ${String(cause)}` }),
    })

    if (!session) {
      return yield* new SessionInvalid({ reason: "no session cookie or expired" })
    }

    // Fall back to the user's first membership when the session has no
    // active organization set yet (immediately post-signup, or post-signin
    // before the SPA has called `setActiveOrganization`). Setting the active
    // org persists for subsequent requests so this is a one-shot fixup.
    let activeOrgId = session.session.activeOrganizationId
    if (!activeOrgId) {
      const orgs = yield* Effect.tryPromise({
        try: () => auth.api.listOrganizations({ headers }),
        catch: (cause) =>
          new SessionInvalid({ reason: `listOrganizations threw: ${String(cause)}` }),
      })
      const first = orgs?.[0]
      if (!first) {
        return yield* new NoActiveOrganization({ userId: session.user.id })
      }
      yield* Effect.tryPromise({
        try: () => auth.api.setActiveOrganization({ headers, body: { organizationId: first.id } }),
        catch: (cause) =>
          new SessionInvalid({ reason: `setActiveOrganization threw: ${String(cause)}` }),
      })
      activeOrgId = first.id
    }

    const userId = yield* Schema.decodeUnknownEffect(UserId)(session.user.id)
    const activeOrganizationId = yield* Schema.decodeUnknownEffect(OrganizationId)(activeOrgId)
    const userKind = yield* Schema.decodeUnknownEffect(Entities.UserKind)(
      (session.user as { kind?: string }).kind ?? "customer",
    )

    // Active role pulled from the member row in the active org. Per better-auth
    // org plugin, `getActiveMemberRole` returns `{ role: string }`.
    const memberRole = yield* Effect.tryPromise({
      try: () => auth.api.getActiveMemberRole({ headers }),
      catch: (cause) =>
        new SessionInvalid({
          reason: `auth.api.getActiveMemberRole threw: ${String(cause)}`,
        }),
    })
    // `UserRole` is `NonEmptyString.brand("UserRole")` so any non-empty role
    // string decodes. The fallback covers the (rare) case where better-auth
    // returns an undefined role for a freshly created membership.
    const role = yield* Schema.decodeUnknownEffect(Entities.UserRole)(
      memberRole?.role && memberRole.role.length > 0 ? memberRole.role : "viewer",
    )

    return {
      userId,
      userKind,
      activeOrganizationId,
      role,
    } satisfies typeof CurrentSession.Service
  }).pipe(
    Effect.catchTag("SchemaError", (e) =>
      Effect.fail(new SessionInvalid({ reason: `session decode failed: ${String(e)}` })),
    ),
  )

/**
 * Convenience: turn an `Effect<A, E, CurrentSession>` into one that pulls the
 * session from `Headers` at the boundary. Use at the HTTP/RPC entry point.
 */
export const provideSessionFromHeaders =
  (headers: Headers) =>
  <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | SessionInvalid | NoActiveOrganization, Exclude<R, CurrentSession>> =>
    Effect.provideServiceEffect(effect, CurrentSession, resolveSession(headers))

/**
 * Permission-check helper. Drops into `Effect.gen` blocks where authorization
 * is required. Uses better-auth's `hasPermission` API which respects dynamic
 * (per-tenant runtime) roles.
 */
export const requirePermission = (
  headers: Headers,
  permissions: Record<string, ReadonlyArray<string>>,
): Effect.Effect<void, SessionInvalid> =>
  Effect.tryPromise({
    try: async () => {
      // better-auth returns `{ error, success }` — the response object itself
      // is always truthy, so `!ok` would silently fail-open. Inspect the
      // documented `success` flag explicitly.
      const res = await auth.api.hasPermission({
        headers,
        body: { permissions },
      })
      if (res.success !== true) {
        throw new Error("permission denied")
      }
    },
    catch: (cause) => new SessionInvalid({ reason: `permission check failed: ${String(cause)}` }),
  })

/** Layer wrapper if a static session is available (tests). */
export const CurrentSessionTest = (
  session: typeof CurrentSession.Service,
): Layer.Layer<CurrentSession> => Layer.succeed(CurrentSession, session)
