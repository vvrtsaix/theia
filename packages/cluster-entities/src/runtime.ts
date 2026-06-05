import { Layer } from "effect"
import { TestRunner } from "effect/unstable/cluster"
import { TicketEntityLive } from "#ticket"

/**
 * Cluster runtime layers.
 *
 *   - `EntitiesLive` — bundle of every entity handler layer.
 *   - `ClusterTestLive` — single-process runner with in-memory storage.
 *     Used by tests and local dev until the production cluster is wired.
 *   - `ClusterProdLive` — placeholder. Wire `NodeClusterSocket.layer()` (or
 *     `BunClusterSocket.layer()`) + `@effect/sql-pg` `MessageStorage` /
 *     `RunnerStorage` once a real deployment lands.
 */

export const EntitiesLive = Layer.mergeAll(TicketEntityLive)

export const ClusterTestLive = EntitiesLive.pipe(Layer.provideMerge(TestRunner.layer))

export const ClusterProdLive = ClusterTestLive // TODO: swap for cluster-socket layer in prod
