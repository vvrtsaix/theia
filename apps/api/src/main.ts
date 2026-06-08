import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { ClusterTestLive } from "@theia/cluster-entities"
import { DatabaseLive } from "@theia/db"
import { OtelLive } from "@theia/otel"
import { RpcServerLive } from "@theia/rpc-server/http"
import { Effect, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { AuthHandlerLive } from "./auth-handler"
import { devSeed } from "./dev-seed"

/**
 * Theia API entrypoint.
 *
 * Layers, outer → inner:
 *   1. OTel SDK (top-level so every span propagates)
 *   2. Postgres pool (`DatabaseLive`) — `provideMerge` so the bootstrap
 *      `devSeed` can use the same connection.
 *   3. Cluster TestRunner + TicketEntity behaviour
 *   4. Bun HTTP server on :3000
 *   5. RPC server group mounts (per-request `CurrentSession` resolved from
 *      cookies inside `@theia/rpc-server/http`).
 *   6. better-auth Fetch handler at `/api/auth/*` (login / signup / logout /
 *      organization CRUD / member invites / role admin).
 */

const HttpLive = HttpRouter.serve(Layer.mergeAll(RpcServerLive, AuthHandlerLive)).pipe(
  Layer.provide(BunHttpServer.layer({ port: 3000 })),
)

/**
 * Cast: the v4 cluster `Entity.toLayer` HandlerServices type does not yet
 * exclude `Entity.CurrentAddress` from inferred requirements — it leaks into
 * the build effect's R even though the cluster runtime provides it
 * per-message. Bug surface in `effect@4.0.0-beta.*`; this cast unblocks the
 * api process while staying honest about runtime behaviour (the address IS
 * supplied at message time, the type system just doesn't know).
 */
const AppLive: Layer.Layer<never, unknown, never> = HttpLive.pipe(
  Layer.provide(ClusterTestLive),
  Layer.provideMerge(DatabaseLive),
  Layer.provide(OtelLive),
) as unknown as Layer.Layer<never, unknown, never>

/**
 * `dev-seed` plants a known credential (`dev@andsystems.tech` / `devdevdev`)
 * for local convenience. Anything other than explicit dev mode must skip it —
 * shipping the seed to staging/prod is an instant root credential on the
 * deployed tenant.
 */
const shouldRunDevSeed = process.env.THEIA_DEV_SEED === "1"

const program = Effect.gen(function* () {
  if (shouldRunDevSeed) {
    yield* devSeed
  } else {
    yield* Effect.logInfo("dev-seed: skipped (set THEIA_DEV_SEED=1 to enable)")
  }
  yield* Effect.logInfo("theia api: listening on http://localhost:3000")
  yield* Effect.never
}).pipe(Effect.provide(AppLive)) as Effect.Effect<never, unknown, never>

BunRuntime.runMain(program)
