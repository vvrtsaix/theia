import { DateTime, Effect, Schema } from "effect"
import { asc, eq } from "drizzle-orm"
import { CurrentSession, Database, Schema as DbSchema } from "@theia/db"
import { Entities, Errors, Rpc as DomainRpc } from "@theia/domain"
import { intoInfra, sessionTenantId } from "#handlers/_shared"

/**
 * System-config handlers — super-admin gated.
 *
 * `system_config` is system-wide, NOT tenant-scoped. RLS is off. Authorization:
 *   - Read (`get`/`list`): any internal/system user.
 *   - Write (`update`):    only `UserKind === "system"`.
 *
 * Writes never affect existing tenants — by design.
 */

type SystemConfigRow = typeof DbSchema.systemConfig.$inferSelect

const decodeRow = (row: SystemConfigRow) =>
  Schema.decodeUnknownEffect(Entities.SystemConfig)({
    key: row.key,
    value: row.value,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  }).pipe(
    Effect.catchTag("SchemaError", (e) =>
      Effect.die(new Error(`system_config row failed domain decode: ${String(e)}`)),
    ),
  )

const requireSuperAdmin = Effect.gen(function* () {
  const session = yield* CurrentSession
  if (session.userKind !== "system") {
    const tenantId = yield* sessionTenantId
    return yield* new Errors.Forbidden({
      tenantId,
      userId: session.userId,
      action: "system.config.update",
    })
  }
})

export const SystemConfigHandlers = DomainRpc.SystemConfigRpc.toLayer({
  "system.config.get": (payload) =>
    Effect.gen(function* () {
      const { db } = yield* Database
      const rows = yield* Effect.tryPromise({
        try: () =>
          db.select().from(DbSchema.systemConfig).where(eq(DbSchema.systemConfig.key, payload.key)),
        catch: intoInfra("system.config.get"),
      })
      if (rows.length === 0) {
        return yield* new Errors.NotFound({ resource: "system_config", id: payload.key })
      }
      return yield* decodeRow(rows[0]!)
    }),

  "system.config.list": () =>
    Effect.gen(function* () {
      const { db } = yield* Database
      const rows = yield* Effect.tryPromise({
        try: () =>
          db.select().from(DbSchema.systemConfig).orderBy(asc(DbSchema.systemConfig.key)),
        catch: intoInfra("system.config.list"),
      })
      return yield* Effect.forEach(rows, decodeRow)
    }),

  "system.config.update": (payload) =>
    Effect.gen(function* () {
      yield* requireSuperAdmin
      const session = yield* CurrentSession
      const { db } = yield* Database
      const now = yield* DateTime.now
      const rows = yield* Effect.tryPromise({
        try: () =>
          db
            .insert(DbSchema.systemConfig)
            .values({
              key: payload.value._tag,
              value: payload.value,
              updatedAt: DateTime.toDate(now),
              updatedBy: session.userId,
            })
            .onConflictDoUpdate({
              target: DbSchema.systemConfig.key,
              set: {
                value: payload.value,
                updatedAt: DateTime.toDate(now),
                updatedBy: session.userId,
              },
            })
            .returning(),
        catch: intoInfra("system.config.update"),
      })
      if (rows.length === 0) {
        return yield* new Errors.ValidationError({
          field: "value",
          message: "INSERT...RETURNING produced no row",
        })
      }
      return yield* decodeRow(rows[0]!)
    }),
})
