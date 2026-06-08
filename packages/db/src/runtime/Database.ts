import { Errors } from "@theia/domain"
import { sql as drizzleSql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import { Config, Context, Effect, Layer, Redacted } from "effect"
import postgres from "postgres"
import { CurrentSession } from "#runtime/CurrentSession"

/**
 * Drizzle-backed DB runtime.
 *
 * Single Pg connection pool shared across all handlers. Tenant binding via
 * `Database.tx(fn)` which:
 *   1. Opens a Drizzle transaction.
 *   2. Issues `SET LOCAL app.tenant_id = <session.activeOrganizationId>`.
 *   3. Runs `fn(tx)` with the typed query builder.
 *
 * `app_user` is `NOBYPASSRLS` (see infra/00-bootstrap.sql), so even a missed
 * `SET LOCAL` returns zero rows (RLS policy uses `current_setting` with the
 * `missing_ok` flag) — never crashes, never leaks across tenants.
 *
 * Handlers MUST go through `Database.tx` for any tenant-scoped query.
 * `Database.db` is exposed for system-wide tables (e.g. `system_config`).
 */

/** Wrap the drizzle call so its full return type (incl. config) flows to consumers. */
const makeDrizzle = (client: postgres.Sql) => drizzle(client, { casing: "snake_case" })

/** Derive types from the value-level `drizzle()` call — no manual generics, no casts. */
export type DrizzleDb = ReturnType<typeof makeDrizzle>
export type DrizzleTx = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0]

export class Database extends Context.Service<
  Database,
  {
    /**
     * The Drizzle instance. Use for **non-tenant-scoped** queries only — RLS is
     * not bound. For anything touching tenant tables, use `tx` or `txAs`.
     */
    readonly db: DrizzleDb

    /**
     * Run a Drizzle tx with `SET LOCAL app.tenant_id` bound from the active
     * `CurrentSession`. The callback receives the Drizzle `tx` handle.
     *
     * Use this for request handlers behind the auth middleware.
     */
    readonly tx: <A>(
      run: (tx: DrizzleTx) => Promise<A>,
    ) => Effect.Effect<A, Errors.InfrastructureError, CurrentSession>

    /**
     * Like `tx` but takes the tenant id explicitly. Use this from cluster
     * entity handlers, which run outside any `CurrentSession` context but
     * always know their tenant from the entity address / message payload.
     */
    readonly txAs: <A>(
      tenantId: string,
      run: (tx: DrizzleTx) => Promise<A>,
    ) => Effect.Effect<A, Errors.InfrastructureError>
  }
>()("@theia/db/Database") {}

const PgUrl = Config.redacted("DATABASE_URL")

/**
 * `postgres-js` connection pool + Drizzle wrapper. `application_name` is
 * tagged so traces and `pg_stat_activity` are filterable by service.
 */
const makePool = Effect.gen(function* () {
  const url = yield* PgUrl
  const sql = postgres(Redacted.value(url), {
    max: 20,
    connection: { application_name: "theia-api" },
  })
  const db = makeDrizzle(sql)
  return { sql, db }
})

export const DatabaseLive = Layer.effect(
  Database,
  Effect.gen(function* () {
    const { db } = yield* Effect.acquireRelease(makePool, ({ sql }) =>
      Effect.promise(() => sql.end({ timeout: 5 })),
    )

    const runInTenantTx = <A>(tenantId: string, run: (tx: DrizzleTx) => Promise<A>) =>
      Effect.tryPromise({
        try: () =>
          db.transaction(async (tx) => {
            // Postgres `SET` does not accept bind parameters; use the
            // `set_config(name, value, is_local)` function instead. `is_local
            // = true` makes the GUC scoped to the current transaction, which
            // is exactly what RLS policies read via `current_setting`.
            await tx.execute(drizzleSql`SELECT set_config('app.tenant_id', ${tenantId}, true)`)
            return run(tx)
          }),
        catch: (e) =>
          new Errors.InfrastructureError({
            component: "Database.tx",
            message: String(e),
          }),
      })

    return Database.of({
      db,
      tx: <A>(run: (tx: DrizzleTx) => Promise<A>) =>
        Effect.gen(function* () {
          const session = yield* CurrentSession
          return yield* runInTenantTx(session.activeOrganizationId, run)
        }),
      txAs: runInTenantTx,
    })
  }),
)
