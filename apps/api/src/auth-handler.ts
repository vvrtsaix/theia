import { auth } from "@theia/auth"
import { Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"

/**
 * Mount the better-auth Fetch handler at `/api/auth/*`.
 *
 * better-auth ships a `Request → Response` handler that owns every auth
 * route: sign-in, sign-up, sign-out, session, organization CRUD, member
 * invites, role admin, etc. We delegate the whole namespace by:
 *
 *   1. Reconstructing a Web `Request` from the Effect `HttpServerRequest`.
 *   2. Awaiting `auth.handler(webReq)`.
 *   3. Wrapping the resulting `Response` in an Effect `HttpServerResponse`
 *      via `HttpServerResponse.fromWeb`.
 *
 * `HttpServerRequest.url` is path-and-query only — better-auth needs an
 * absolute URL to perform internal routing, so we rebuild against
 * `BETTER_AUTH_URL` (or the dev fallback). Wildcard path `/api/auth/*`
 * captures every sub-route under the auth namespace.
 */
const baseUrl = (): string => process.env.BETTER_AUTH_URL ?? "http://localhost:3000"

/**
 * The Web `Request` constructor rejects a non-null `body` on methods that
 * MUST NOT carry one (GET, HEAD, OPTIONS, DELETE preflight). Reading
 * `arrayBuffer` on those would also hang waiting for body framing that
 * never arrives.
 */
const hasBody = (method: string): boolean => {
  switch (method) {
    case "POST":
    case "PUT":
    case "PATCH":
      return true
    default:
      return false
  }
}

const handle = Effect.gen(function* () {
  const req = yield* HttpServerRequest.HttpServerRequest

  const body = hasBody(req.method) ? yield* req.arrayBuffer : undefined

  // Forward the inbound `AbortSignal` so client disconnects cancel any
  // in-flight better-auth work (mail send, password hash, DB writes) rather
  // than leaking fibers + DB connections for the lifetime of the operation.
  const signal: AbortSignal | undefined = (req.source as { signal?: AbortSignal })?.signal

  const webReq = new Request(new URL(req.url, baseUrl()), {
    method: req.method,
    headers: req.headers as unknown as HeadersInit,
    body,
    signal,
  })

  const webRes = yield* Effect.promise(() => auth.handler(webReq))
  return HttpServerResponse.fromWeb(webRes)
})

export const AuthHandlerLive = HttpRouter.add("*", "/api/auth/*", handle)
