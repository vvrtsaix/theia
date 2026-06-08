import { NodeClusterSocket } from "@effect/platform-node"
import { PgClient } from "@effect/sql-pg"
import { Config, Layer } from "effect"
import { TestRunner } from "effect/unstable/cluster"
import { TicketEntityLive } from "#ticket"

/**
 * Cluster runtime layers.
 *
 *   - `EntitiesLive` — bundle of every entity handler layer.
 *   - `ClusterTestLive` — single-process runner with in-memory storage.
 *     Used by tests and local dev.
 *   - `ClusterProdLive` — multi-node socket transport + Pg-backed
 *     `MessageStorage` + `RunnerStorage`. Reads `DATABASE_URL` (separate
 *     pool from `@theia/db` to keep cluster I/O isolated from request
 *     traffic) and Sharding env vars (`SHARDING_*`).
 */

export const EntitiesLive = Layer.mergeAll(TicketEntityLive)

export const ClusterTestLive = EntitiesLive.pipe(Layer.provideMerge(TestRunner.layer))

/**
 * Production cluster runtime.
 *
 * Layer composition (outer → inner):
 *   1. `EntitiesLive` — every entity behavior
 *   2. `NodeClusterSocket.layer()` — socket transport for inter-runner RPC;
 *      defaults to Pg-backed `MessageStorage` + `RunnerStorage` (the
 *      `storage: undefined` branch in `NodeClusterSocket.layer`)
 *   3. `PgClient.layerConfig` — dedicated Pg connection for cluster
 *      metadata. `application_name` distinguishes it from the request pool
 *      in `pg_stat_activity`.
 *
 * `ShardingConfig.layerFromEnv` (composed inside `NodeClusterSocket.layer`)
 * reads runner identity from the environment — set per-replica via the
 * orchestrator (`SHARDING_RUNNER_HOST`, `SHARDING_RUNNER_PORT`, etc.).
 */
export const ClusterProdLive = EntitiesLive.pipe(
  Layer.provideMerge(NodeClusterSocket.layer()),
  Layer.provide(
    PgClient.layerConfig({
      url: Config.redacted("DATABASE_URL"),
      applicationName: Config.succeed("theia-cluster"),
    }),
  ),
)
