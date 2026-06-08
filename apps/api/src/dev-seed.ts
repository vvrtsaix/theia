import { auth } from "@theia/auth"
import { Database, Schema as DbSchema } from "@theia/db"
import { Entities } from "@theia/domain"
import { and, eq } from "drizzle-orm"
import { Effect } from "effect"

/**
 * Idempotent dev bootstrap.
 *
 * Creates a default dev account + tenant so the local dev server is usable
 * without manual signup:
 *
 *   - User    : `dev@andsystems.tech`  /  password `devdevdev`
 *   - Tenant  : "AndSystems"  (slug `andsystems`)
 *   - Role    : `owner`
 *   - Workflow: domain `defaultWorkflowSeed`
 *
 * Production removes this file from the boot path and relies on the real
 * signup flow.
 */

const DEV_EMAIL = "dev@andsystems.tech"
const DEV_PASSWORD = "devdevdev"
const DEV_NAME = "Uurtsaikh Nyambat"
const DEV_TENANT_SLUG = "andsystems"
const DEV_TENANT_NAME = "AndSystems"

export const devSeed = Effect.gen(function* () {
  const db = yield* Database

  // 1. User + credential — go through better-auth so the `account` row with a
  //    hashed password is created alongside the `user` row. If the user
  //    already exists (subsequent boots), signUp returns a `USER_ALREADY_EXISTS`
  //    error which we catch and resolve to the existing user id.
  const userId = yield* Effect.tryPromise({
    try: () =>
      auth.api.signUpEmail({ body: { email: DEV_EMAIL, password: DEV_PASSWORD, name: DEV_NAME } }),
    catch: (e) => new Error(`dev-seed signUp: ${String(e)}`),
  }).pipe(
    Effect.map((res) => res.user.id),
    Effect.catch(() =>
      Effect.tryPromise({
        try: () =>
          db.db
            .select({ id: DbSchema.users.id })
            .from(DbSchema.users)
            .where(eq(DbSchema.users.email, DEV_EMAIL))
            .limit(1),
        catch: (e) => new Error(`dev-seed user lookup: ${String(e)}`),
      }).pipe(
        Effect.flatMap((rows) =>
          rows.length === 0
            ? Effect.fail(new Error("dev-seed: signUp failed and no existing user found"))
            : Effect.succeed(rows[0]!.id),
        ),
      ),
    ),
  )

  // 2. Tenant — idempotent via slug uniqueness; query first to avoid pk churn.
  const tenantId = yield* Effect.tryPromise({
    try: () =>
      db.db
        .select({ id: DbSchema.organizations.id })
        .from(DbSchema.organizations)
        .where(eq(DbSchema.organizations.slug, DEV_TENANT_SLUG))
        .limit(1),
    catch: (e) => new Error(`dev-seed org lookup: ${String(e)}`),
  }).pipe(
    Effect.flatMap((rows) =>
      rows.length > 0
        ? Effect.succeed(rows[0]!.id)
        : Effect.tryPromise({
            try: () =>
              db.db
                .insert(DbSchema.organizations)
                .values({ name: DEV_TENANT_NAME, slug: DEV_TENANT_SLUG })
                .returning({ id: DbSchema.organizations.id }),
            catch: (e) => new Error(`dev-seed org insert: ${String(e)}`),
          }).pipe(Effect.map((r) => r[0]!.id)),
    ),
  )

  // 3. Membership — query first; `(user_id, organization_id)` has no unique
  //    constraint in the better-auth schema so `onConflictDoNothing` won't
  //    deduplicate. Insert only when missing.
  const existingMember = yield* Effect.tryPromise({
    try: () =>
      db.db
        .select({ id: DbSchema.members.id })
        .from(DbSchema.members)
        .where(
          and(eq(DbSchema.members.userId, userId), eq(DbSchema.members.organizationId, tenantId)),
        )
        .limit(1),
    catch: (e) => new Error(`dev-seed member lookup: ${String(e)}`),
  })

  if (existingMember.length === 0) {
    yield* Effect.tryPromise({
      try: () =>
        db.db.insert(DbSchema.members).values({ userId, organizationId: tenantId, role: "owner" }),
      catch: (e) => new Error(`dev-seed member insert: ${String(e)}`),
    })
  }

  // 4. Workflow — `tenantId` is the PK so `onConflictDoNothing` deduplicates.
  //    `workflow` has RLS enabled (`app_user` is NOBYPASSRLS) and the policy
  //    references `app.tenant_id`; use `txAs` so the GUC is set before the
  //    INSERT runs — a plain `db.db.insert(...)` is rejected by RLS.
  yield* db
    .txAs(tenantId, (tx) =>
      tx
        .insert(DbSchema.workflows)
        .values({
          tenantId,
          statuses: Entities.defaultWorkflowSeed.statuses,
          priorities: Entities.defaultWorkflowSeed.priorities,
          transitions: Entities.defaultWorkflowSeed.transitions,
          types: Entities.defaultWorkflowSeed.types,
          tags: Entities.defaultWorkflowSeed.tags,
          defaultStatus: Entities.defaultWorkflowSeed.defaultStatus,
          defaultPriority: Entities.defaultWorkflowSeed.defaultPriority,
          defaultTypeKey: Entities.defaultWorkflowSeed.defaultTypeKey,
        })
        .onConflictDoNothing(),
    )
    .pipe(Effect.mapError((e) => new Error(`dev-seed workflow: ${String(e.message ?? e)}`)))

  yield* Effect.logInfo(
    `dev-seed: user=${DEV_EMAIL} tenant=${DEV_TENANT_SLUG} (pwd=${DEV_PASSWORD})`,
  )
})
