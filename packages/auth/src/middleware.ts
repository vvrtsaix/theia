import { Effect, Layer, Schema } from "effect"
import { CurrentSession } from "@theia/db"
import { Entities, OrganizationId, UserId } from "@theia/domain"
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

    if (!session.session.activeOrganizationId) {
      return yield* new NoActiveOrganization({ userId: session.user.id })
    }

    const userId = yield* Schema.decodeUnknownEffect(UserId)(session.user.id)
    const activeOrganizationId = yield* Schema.decodeUnknownEffect(OrganizationId)(
      session.session.activeOrganizationId,
    )
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
    const role = yield* Schema.decodeUnknownEffect(Entities.UserRole)(memberRole.role ?? "viewer")

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
      const ok = await auth.api.hasPermission({
        headers,
        body: { permissions },
      })
      if (!ok) {
        throw new Error("permission denied")
      }
    },
    catch: (cause) =>
      new SessionInvalid({ reason: `permission check failed: ${String(cause)}` }),
  })

/** Layer wrapper if a static session is available (tests). */
export const CurrentSessionTest = (
  session: typeof CurrentSession.Service,
): Layer.Layer<CurrentSession> => Layer.succeed(CurrentSession, session)
