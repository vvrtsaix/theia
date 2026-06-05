import { Effect, Layer, ManagedRuntime, Scope } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { RpcClient, RpcSerialization } from "effect/unstable/rpc"
import { Rpc as DomainRpc } from "@theia/domain"

/**
 * Browser-side RPC client. One `ManagedRuntime` per app; tear down via
 * `dispose()` on shutdown.
 *
 * Each client's methods return `Promise<A, RpcError>` — friendly for Solid
 * `createResource`, TanStack Query, or direct `await` inside event handlers.
 *
 * Cookies attached automatically — `FetchHttpClient.layer` uses the browser
 * fetch which sends same-origin cookies by default. better-auth's session
 * cookie survives.
 */

const baseLayers = Layer.mergeAll(RpcSerialization.layerJson, FetchHttpClient.layer)

const transportFor = (url: string) =>
  RpcClient.layerProtocolHttp({ url }).pipe(Layer.provide(baseLayers))

/**
 * Build a single client. Wrapped with `Scope.make` + `Scope.provide` so the
 * resulting Effect has no remaining requirements — `ManagedRuntime` can run it.
 */
const buildClient = <A, E, R>(effect: Effect.Effect<A, E, R | Scope.Scope>) =>
  Effect.flatMap(Scope.make(), (scope) => Scope.provide(effect, scope))

export const makeClients = (baseUrl = "") => {
  const runtime = ManagedRuntime.make(Layer.empty)

  const clients = Promise.all([
    runtime.runPromise(
      buildClient(
        RpcClient.make(DomainRpc.TicketRpc).pipe(
          Effect.provide(transportFor(`${baseUrl}/rpc/ticket`)),
        ),
      ),
    ),
    runtime.runPromise(
      buildClient(
        RpcClient.make(DomainRpc.WorkflowRpc).pipe(
          Effect.provide(transportFor(`${baseUrl}/rpc/workflow`)),
        ),
      ),
    ),
    runtime.runPromise(
      buildClient(
        RpcClient.make(DomainRpc.NotificationRpc).pipe(
          Effect.provide(transportFor(`${baseUrl}/rpc/notification`)),
        ),
      ),
    ),
    runtime.runPromise(
      buildClient(
        RpcClient.make(DomainRpc.SystemConfigRpc).pipe(
          Effect.provide(transportFor(`${baseUrl}/rpc/system`)),
        ),
      ),
    ),
  ]).then(([ticket, workflow, notification, system]) => ({
    ticket,
    workflow,
    notification,
    system,
  }))

  return {
    runtime,
    clients,
    dispose: () => runtime.dispose(),
  }
}

export type TheiaClients = Awaited<ReturnType<typeof makeClients>["clients"]>
