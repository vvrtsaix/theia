import { Layer } from "effect"
import { RpcSerialization, RpcServer } from "effect/unstable/rpc"
import { Rpc as DomainRpc } from "@theia/domain"
import { AllHandlers } from "#handlers"

/**
 * HTTP mount for every RPC group. Layered so the consumer (`apps/api`) only
 * has to provide:
 *   - `HttpRouter.HttpRouter`        — from `@effect/platform-bun`
 *   - `RpcSerialization.RpcSerialization` — pick JSON / msgpack
 *   - `Database` + `SqlClient` + `CurrentSession`
 *   - `TicketEntity` client (Phase 5)
 */

/** JSON serialization is the default for our SPA <-> API channel. */
export const SerializationLive = RpcSerialization.layerJson

/** Mount points per group. Keep paths stable — clients depend on these. */
export const TicketRpcServer = RpcServer.layerHttp({
  group: DomainRpc.TicketRpc,
  path: "/rpc/ticket",
}).pipe(Layer.provide(AllHandlers))

export const WorkflowRpcServer = RpcServer.layerHttp({
  group: DomainRpc.WorkflowRpc,
  path: "/rpc/workflow",
}).pipe(Layer.provide(AllHandlers))

export const NotificationRpcServer = RpcServer.layerHttp({
  group: DomainRpc.NotificationRpc,
  path: "/rpc/notification",
}).pipe(Layer.provide(AllHandlers))

export const SystemRpcServer = RpcServer.layerHttp({
  group: DomainRpc.SystemConfigRpc,
  path: "/rpc/system",
}).pipe(Layer.provide(AllHandlers))

/** Bundle everything for the API process. */
export const RpcServerLive = Layer.mergeAll(
  TicketRpcServer,
  WorkflowRpcServer,
  NotificationRpcServer,
  SystemRpcServer,
).pipe(Layer.provide(SerializationLive))
