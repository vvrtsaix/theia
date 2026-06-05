import { Config, Effect } from "effect"
import { NodeSdk } from "@effect/opentelemetry"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base"

/**
 * OpenTelemetry SDK layer.
 *
 * Wraps the entire `AppLive` stack so every Effect fiber, Pg query (via
 * `postgres-js` spans), HTTP handler, and Cluster entity message produces
 * a span. Exports OTLP over HTTP to the otel-collector (docker-compose)
 * which fans out to Jaeger locally.
 *
 * Config (via Effect `Config`):
 *   - `OTEL_EXPORTER_OTLP_ENDPOINT` — collector URL
 *   - `OTEL_SERVICE_NAME`           — service identifier
 *   - `OTEL_SERVICE_VERSION`        — semantic version tag
 *
 * Tests / non-prod can override via `Layer.setConfigProvider`.
 */
const OtelConfig = Config.all({
  endpoint: Config.string("OTEL_EXPORTER_OTLP_ENDPOINT").pipe(
    Config.withDefault("http://localhost:4318/v1/traces"),
  ),
  serviceName: Config.string("OTEL_SERVICE_NAME").pipe(Config.withDefault("theia-api")),
  serviceVersion: Config.string("OTEL_SERVICE_VERSION").pipe(Config.withDefault("0.0.0")),
})

export const OtelLive = NodeSdk.layer(
  Effect.map(OtelConfig, (c) => ({
    resource: {
      serviceName: c.serviceName,
      serviceVersion: c.serviceVersion,
    },
    spanProcessor: new BatchSpanProcessor(new OTLPTraceExporter({ url: c.endpoint })),
  })),
)
