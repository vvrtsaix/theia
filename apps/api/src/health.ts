import { Database } from "@theia/db"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"

/**
 * Health endpoints.
 *
 *   - `GET /healthz` — liveness. 200 as long as the process is up. Used by
 *     orchestrators (Docker / k8s) to decide whether to restart the container.
 *
 *   - `GET /readyz` — readiness. Runs a cheap `SELECT 1` against the DB. If
 *     the pool can't service it, return 503 so load balancers stop sending
 *     traffic. Treats DB outage as "not ready" rather than "dead" — the
 *     process is fine, the dependency isn't.
 *
 * Both routes bypass auth. Don't include version metadata or env in
 * responses — health endpoints are unauthenticated and shouldn't leak
 * fingerprinting data.
 */

export const HealthLive = HttpRouter.addAll([
  HttpRouter.route(
    "GET",
    "/healthz",
    Effect.succeed(HttpServerResponse.text("ok", { status: 200 })),
  ),
  HttpRouter.route(
    "GET",
    "/readyz",
    Effect.gen(function* () {
      const db = yield* Database
      return yield* Effect.tryPromise({
        try: () => db.db.execute(sql`SELECT 1`),
        catch: (e) => new Error(String(e)),
      }).pipe(
        Effect.as(HttpServerResponse.text("ready", { status: 200 })),
        Effect.catch((e: { message: string }) =>
          Effect.logWarning(`/readyz: ${e.message}`).pipe(
            Effect.as(HttpServerResponse.text("not ready", { status: 503 })),
          ),
        ),
      )
    }),
  ),
])
