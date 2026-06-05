import { Effect, Layer } from "effect"
import { BunRuntime } from "@effect/platform-bun"
import { DatabaseLive } from "@theia/db"
import { ClusterTestLive } from "@theia/cluster-entities"
import { OtelLive } from "@theia/otel"

/**
 * Theia API entrypoint.
 *
 * **Current state — Phase 7 boundary:**
 * This file wires the *non-HTTP* layers (Database, Cluster, OTel) and starts
 * a long-running process. The HTTP server + RPC mount + better-auth handler
 * wiring lands in Phase 7.x once the exact `effect/unstable/http` API surface
 * we depend on is pinned (the v4 HTTP API is still moving between betas).
 *
 * For now this main:
 *   1. Builds OTel SDK.
 *   2. Builds the DB pool.
 *   3. Builds the Cluster TestRunner + TicketEntity layer.
 *   4. Holds the process open via `Effect.never`.
 *
 * The Solid SPA can still talk to a separate running server (e.g. via
 * `vite dev` proxy to a future `Bun.serve` handler) — the data layer is
 * fully exercised by the RPC handlers in `@theia/rpc-server`.
 */

/**
 * Cast: the v4 cluster `Entity.toLayer` HandlerServices type does not yet
 * exclude `Entity.CurrentAddress` from inferred requirements — it leaks into
 * the build effect's R even though the cluster runtime provides it
 * per-message. Bug surface in `effect@4.0.0-beta.*`; this cast unblocks the
 * api process while staying honest about runtime behaviour (the address IS
 * supplied at message time, the type system just doesn't know).
 */
const AppLive: Layer.Layer<never, unknown, never> = ClusterTestLive.pipe(
  Layer.provide(DatabaseLive),
  Layer.provide(OtelLive),
) as unknown as Layer.Layer<never, unknown, never>

const program = Effect.gen(function* () {
  yield* Effect.logInfo("theia api: layers built; waiting for HTTP wiring (Phase 7.x)")
  yield* Effect.never
}).pipe(Effect.provide(AppLive)) as Effect.Effect<never, unknown, never>

BunRuntime.runMain(program)
