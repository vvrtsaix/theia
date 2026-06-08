import { createServer } from "node:http"
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { ClusterProdLive, ClusterTestLive } from "@theia/cluster-entities"
import {
  DatabaseLive,
  EventChannelLive,
  LoggerSinkLive,
  NotificationDispatcherLive,
  NotificationSinkRunnerLive,
} from "@theia/db"
import { OtelLive } from "@theia/otel"
import { RpcServerLive } from "@theia/rpc-server/http"
import { Effect, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { AuthHandlerLive } from "./auth-handler.ts"
import { devSeed } from "./dev-seed.ts"
import { HealthLive } from "./health.ts"

/**
 * Theia API entrypoint.
 *
 * Layers, outer → inner:
 *   1. OTel SDK (top-level so every span propagates)
 *   2. Postgres pool (`DatabaseLive`) — `provideMerge` so the bootstrap
 *      `devSeed` can use the same connection.
 *   3. Cluster TestRunner + TicketEntity behaviour
 *   4. Node HTTP server on :3000
 *   5. RPC server group mounts (per-request `CurrentSession` resolved from
 *      cookies inside `@theia/rpc-server/http`).
 *   6. better-auth Fetch handler at `/api/auth/*` (login / signup / logout /
 *      organization CRUD / member invites / role admin).
 */

const HttpLive = HttpRouter.serve(Layer.mergeAll(RpcServerLive, AuthHandlerLive, HealthLive)).pipe(
  Layer.provide(NodeHttpServer.layer(() => createServer(), { port: 3000 })),
)

/**
 * Cast: the v4 cluster `Entity.toLayer` HandlerServices type does not yet
 * exclude `Entity.CurrentAddress` from inferred requirements — it leaks into
 * the build effect's R even though the cluster runtime provides it
 * per-message. Bug surface in `effect@4.0.0-beta.*`; this cast unblocks the
 * api process while staying honest about runtime behaviour (the address IS
 * supplied at message time, the type system just doesn't know).
 */
/**
 * Cluster runtime selection.
 *
 *   - `THEIA_CLUSTER=prod` → `ClusterProdLive` (socket transport + Pg
 *     MessageStorage / RunnerStorage). Required for multi-node deployments.
 *   - default (`test` / unset) → `ClusterTestLive` (single-process,
 *     in-memory). Used by local dev + tests.
 *
 * Decision lives here because it's an infrastructure choice tied to the
 * deployment topology, not a per-package concern.
 */
const ClusterLive = process.env.THEIA_CLUSTER === "prod" ? ClusterProdLive : ClusterTestLive

/**
 * Notification pipeline.
 *
 *   - `NotificationDispatcherLive` — subscribes to `EventChannel.ticketEvents`,
 *     fans out per (subscribed participant ≠ actor), inserts notification rows.
 *     Pg trigger then fires `notification_inserted` for the `notification.stream` RPC.
 *
 *   - `LoggerSinkLive` + `NotificationSinkRunnerLive` — stub external delivery
 *     (logs only). Replace `LoggerSinkLive` with `SmtpSinkLive` /
 *     `WebhookSinkLive` in prod.
 */
const NotificationsLive = Layer.mergeAll(
  NotificationDispatcherLive,
  NotificationSinkRunnerLive.pipe(Layer.provide(LoggerSinkLive)),
)

const AppLive: Layer.Layer<never, unknown, never> = HttpLive.pipe(
  Layer.provide(ClusterLive),
  Layer.provideMerge(NotificationsLive),
  Layer.provideMerge(EventChannelLive),
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
  // Finalizer fires on SIGTERM/SIGINT (via NodeRuntime.runMain). Layer
  // acquireRelease handlers above (DB pool, EventChannel LISTEN connection,
  // HTTP server) clean up before the process exits. This log line is the
  // last write before the runtime tears those down — visible in logs so we
  // can confirm a clean shutdown actually happened.
  yield* Effect.addFinalizer(() => Effect.logInfo("theia api: shutting down"))
  yield* Effect.never
}).pipe(Effect.scoped, Effect.provide(AppLive)) as Effect.Effect<never, unknown, never>

NodeRuntime.runMain(program)
