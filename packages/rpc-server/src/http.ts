import { resolveSession } from "@theia/auth"
import { CurrentSession } from "@theia/db"
import { Rpc as DomainRpc } from "@theia/domain"
import { type Cause, Effect, Layer } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { type Rpc, type RpcGroup, RpcSerialization, RpcServer } from "effect/unstable/rpc"
import { AllHandlers } from "#handlers"

/**
 * HTTP mount for every RPC group.
 *
 * Why we bypass `RpcServer.layerHttp`:
 *   - `layerHttp` registers a fixed route handler that has no hook for
 *     per-request service injection.
 *   - We need to provide `CurrentSession` (resolved from the request cookie
 *     via better-auth) to the handler chain on every call.
 *
 * Solution: build each group's HTTP handler via `RpcServer.toHttpEffect`,
 * wrap it with `Effect.provideServiceEffect(CurrentSession, …)` reading the
 * active `HttpServerRequest`, then register each as a route via
 * `HttpRouter.addAll`.
 *
 * Auth failures (`SessionInvalid`, `NoActiveOrganization`) are mapped to
 * 401 / 412 at this boundary so domain RPC error unions stay clean.
 */

/** JSON serialization is the default for our SPA ↔ API channel. */
export const SerializationLive = RpcSerialization.layerJson

/**
 * Resolve `CurrentSession` from the active request. Runs per request via
 * `Effect.provideServiceEffect`, so each invocation sees a fresh session
 * decoded from the inbound cookie / Authorization header.
 */
const sessionFromRequest = Effect.gen(function* () {
  const req = yield* HttpServerRequest.HttpServerRequest
  return yield* resolveSession(req.headers as unknown as Headers)
})

/**
 * Build a single RPC group's per-request handler effect, with session
 * injection + auth-error → HTTP response mapping + OTel span +
 * unmapped-defect → 500 boundary baked in.
 *
 * Span shape: `rpc.<groupName>` so traces group by domain area. Request
 * method + path attach as attributes for filtering. Unmapped defects
 * (anything that wasn't surfaced via the RPC error union) are logged with
 * cause + mapped to 500 — never leak a raw stack to the client.
 */
const buildGroup = <Rpcs extends Rpc.Any>(name: string, group: RpcGroup.RpcGroup<Rpcs>) =>
  Effect.gen(function* () {
    const httpApp = yield* RpcServer.toHttpEffect(group)
    const handler = httpApp.pipe(
      Effect.provideServiceEffect(CurrentSession, sessionFromRequest),
      Effect.catchTags({
        SessionInvalid: (e) => Effect.succeed(HttpServerResponse.text(e.reason, { status: 401 })),
        NoActiveOrganization: () =>
          Effect.succeed(HttpServerResponse.text("no active organization", { status: 412 })),
      }),
      Effect.catchCause((cause: Cause.Cause<unknown>) =>
        // Pass the cause object directly — the Effect logger formats lazily
        // and structured loggers (OTel, JSON) can keep the cause tree
        // intact. `Cause.pretty` was being called eagerly on every error;
        // dropping it lets the logger decide cost.
        Effect.logError(`rpc.${name} failed`, cause).pipe(
          Effect.as(HttpServerResponse.text("internal error", { status: 500 })),
        ),
      ),
    )
    return HttpServerRequest.HttpServerRequest.pipe(
      Effect.flatMap((req) =>
        handler.pipe(
          Effect.withSpan(`rpc.${name}`, {
            attributes: {
              "http.method": req.method,
              "http.route": req.url,
              "rpc.group": name,
            },
          }),
        ),
      ),
    )
  })

const routes = Effect.gen(function* () {
  const ticket = yield* buildGroup("ticket", DomainRpc.TicketRpc)
  const workflow = yield* buildGroup("workflow", DomainRpc.WorkflowRpc)
  const notification = yield* buildGroup("notification", DomainRpc.NotificationRpc)
  const system = yield* buildGroup("system", DomainRpc.SystemConfigRpc)
  const audit = yield* buildGroup("audit", DomainRpc.AuditRpc)
  const search = yield* buildGroup("search", DomainRpc.SearchRpc)
  const bulk = yield* buildGroup("bulk", DomainRpc.BulkRpc)
  return [
    HttpRouter.route("POST", "/rpc/ticket", ticket),
    HttpRouter.route("POST", "/rpc/workflow", workflow),
    HttpRouter.route("POST", "/rpc/notification", notification),
    HttpRouter.route("POST", "/rpc/system", system),
    HttpRouter.route("POST", "/rpc/audit", audit),
    HttpRouter.route("POST", "/rpc/search", search),
    HttpRouter.route("POST", "/rpc/bulk", bulk),
  ] as const
})

/** Bundle every group + the JSON serialization + the handler implementations. */
export const RpcServerLive = HttpRouter.addAll(routes).pipe(
  Layer.provide(AllHandlers),
  Layer.provide(SerializationLive),
)
