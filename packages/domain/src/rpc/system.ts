import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"
import { SystemConfig, SystemConfigKey, SystemConfigValue } from "#entities/SystemConfig"
import { Forbidden, InfrastructureError, NotFound, Unauthorized, ValidationError } from "#errors"

/**
 * Super-admin (`UserKind = "system"`) only. Edits the `system_config` table
 * that seeds new tenants. Existing tenants are NOT affected by these writes
 * — by design.
 *
 * Permission gate: `system:update`. Standard tenant admins can read but not
 * write. Customers cannot access this group at all.
 */
export const SystemConfigRpc = RpcGroup.make(
  Rpc.make("system.config.get", {
    payload: { key: SystemConfigKey },
    success: SystemConfig,
    error: Schema.Union([Unauthorized, Forbidden, NotFound, InfrastructureError]),
  }),

  Rpc.make("system.config.list", {
    success: Schema.Array(SystemConfig),
    error: Schema.Union([Unauthorized, Forbidden, InfrastructureError]),
  }),

  Rpc.make("system.config.update", {
    payload: { value: SystemConfigValue },
    success: SystemConfig,
    error: Schema.Union([Unauthorized, Forbidden, ValidationError, InfrastructureError]),
  }),
)
