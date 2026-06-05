import { Schema } from "effect"
import {
  TicketPriority,
  TicketStatus,
  TicketType,
  WorkflowPriority,
  WorkflowStatus,
  WorkflowTag,
  WorkflowTransition,
  WorkflowType,
} from "#entities/Workflow"

/**
 * System-wide configuration. Seeds new tenants; each tenant edits its own
 * copy. Stored in the `system_config` table as `(key, value)` JSONB rows.
 *
 * Each variant is a `TaggedStruct` whose `_tag` matches the row key. Pattern-
 * match with `Match.valueTags` when consuming.
 *
 * To add a new config category: add a variant, add an `id` literal, write a
 * seed entry in the bootstrap migration. No DB schema change required.
 */

/** Default workflow used to seed every new tenant's `Workflow` row. */
export const SystemWorkflowDefaults = Schema.TaggedStruct("workflow_defaults", {
  statuses: Schema.Array(WorkflowStatus),
  priorities: Schema.Array(WorkflowPriority),
  transitions: Schema.Array(WorkflowTransition),
  types: Schema.Array(WorkflowType),
  tags: Schema.Array(WorkflowTag),
  defaultStatus: TicketStatus,
  defaultPriority: TicketPriority,
  defaultTypeKey: Schema.NullOr(TicketType),
})
export type SystemWorkflowDefaults = typeof SystemWorkflowDefaults.Type

/** Discriminated union of every config category. Extend with new variants. */
export const SystemConfigValue = Schema.Union([SystemWorkflowDefaults])
export type SystemConfigValue = typeof SystemConfigValue.Type

/** Closed list of known config keys — matches `_tag` of each variant. */
export const SystemConfigKey = Schema.Literals(["workflow_defaults"])
export type SystemConfigKey = typeof SystemConfigKey.Type

/**
 * Persisted row shape. The DB row's `id` column = `value._tag` (enforced at
 * the handler layer + asserted by the parity test).
 */
export class SystemConfig extends Schema.Class<SystemConfig>("SystemConfig")({
  key: SystemConfigKey,
  value: SystemConfigValue,
  updatedAt: Schema.DateTimeUtcFromString,
  updatedBy: Schema.NullOr(Schema.NonEmptyString),
}) {}
