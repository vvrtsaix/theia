import { Schema } from "effect"
import { TenantId } from "#ids"

/**
 * Per-tenant Workflow — defines the universe of valid ticket statuses,
 * priorities, types, tags, and allowed status transitions.
 *
 * Seeded on tenant creation; tenant admins can add/edit/remove entries
 * subject to invariants:
 *
 *   1. At least one status must be `terminal: true`.
 *   2. `defaultStatus` and `defaultPriority` must exist.
 *   3. `defaultTypeKey` (if set) must exist in `types`.
 *
 * v0: types share one Workflow. Future: per-type state machines (see
 * ARCHITECTURE.md → "Per-type workflows (deferred)").
 */

// ────────────────────────────────────────────────────────────────────────────
// Branded opaque strings — actual valid values live in DB per tenant
// ────────────────────────────────────────────────────────────────────────────

export const TicketStatus = Schema.NonEmptyString.pipe(Schema.brand("TicketStatus"))
export type TicketStatus = typeof TicketStatus.Type

export const TicketPriority = Schema.NonEmptyString.pipe(Schema.brand("TicketPriority"))
export type TicketPriority = typeof TicketPriority.Type

export const TicketType = Schema.NonEmptyString.pipe(Schema.brand("TicketType"))
export type TicketType = typeof TicketType.Type

export const TicketTag = Schema.NonEmptyString.pipe(Schema.brand("TicketTag"))
export type TicketTag = typeof TicketTag.Type

// ────────────────────────────────────────────────────────────────────────────
// Workflow members
// ────────────────────────────────────────────────────────────────────────────

export class WorkflowStatus extends Schema.Class<WorkflowStatus>("WorkflowStatus")({
  key: TicketStatus,
  label: Schema.NonEmptyString,
  /** Display color (hex or named). UI only — never inspect in domain logic. */
  color: Schema.NonEmptyString,
  /** Terminal states cannot transition further; at least one must exist. */
  terminal: Schema.Boolean,
}) {}

export class WorkflowPriority extends Schema.Class<WorkflowPriority>("WorkflowPriority")({
  key: TicketPriority,
  label: Schema.NonEmptyString,
  color: Schema.NonEmptyString,
  /** Sort order — higher = more urgent. Used for default lists and SLA math. */
  weight: Schema.Int,
}) {}

export class WorkflowTransition extends Schema.Class<WorkflowTransition>("WorkflowTransition")({
  from: TicketStatus,
  to: TicketStatus,
}) {}

export class WorkflowType extends Schema.Class<WorkflowType>("WorkflowType")({
  key: TicketType,
  label: Schema.NonEmptyString,
  color: Schema.NonEmptyString,
  /** Optional lucide-solid icon name; UI-only hint. */
  icon: Schema.NullOr(Schema.NonEmptyString),
  /** Default priority for new tickets of this type. Must exist in `priorities`. */
  defaultPriority: Schema.NullOr(TicketPriority),
}) {}

export class WorkflowTag extends Schema.Class<WorkflowTag>("WorkflowTag")({
  key: TicketTag,
  label: Schema.NonEmptyString,
  color: Schema.NonEmptyString,
}) {}

export class Workflow extends Schema.Class<Workflow>("Workflow")({
  tenantId: TenantId,
  statuses: Schema.Array(WorkflowStatus),
  priorities: Schema.Array(WorkflowPriority),
  transitions: Schema.Array(WorkflowTransition),
  types: Schema.Array(WorkflowType),
  tags: Schema.Array(WorkflowTag),
  defaultStatus: TicketStatus,
  defaultPriority: TicketPriority,
  /** Optional — set if the tenant requires a type on every ticket. */
  defaultTypeKey: Schema.NullOr(TicketType),
  updatedAt: Schema.DateTimeUtcFromString,
}) {}

// ────────────────────────────────────────────────────────────────────────────
// Bootstrap-only seed. The runtime source of truth is `system_config` →
// `workflow_defaults` (see `SystemConfig.ts`). This constant is used:
//   1. To seed the initial `system_config.workflow_defaults` row at install.
//   2. As a fallback in tests that don't want to spin up the system_config
//      table.
// Editing this DOES NOT propagate to live tenants — update via the super-
// admin `system.config.update` RPC instead.
// ────────────────────────────────────────────────────────────────────────────

const status = (key: string) => Schema.decodeSync(TicketStatus)(key)
const priority = (key: string) => Schema.decodeSync(TicketPriority)(key)
const type = (key: string) => Schema.decodeSync(TicketType)(key)
const tag = (key: string) => Schema.decodeSync(TicketTag)(key)

export const defaultWorkflowSeed = {
  statuses: [
    { key: status("open"), label: "Open", color: "#3b82f6", terminal: false },
    { key: status("in_progress"), label: "In Progress", color: "#f59e0b", terminal: false },
    {
      key: status("waiting_on_customer"),
      label: "Waiting on Customer",
      color: "#a855f7",
      terminal: false,
    },
    { key: status("resolved"), label: "Resolved", color: "#10b981", terminal: false },
    { key: status("closed"), label: "Closed", color: "#6b7280", terminal: true },
  ],
  priorities: [
    { key: priority("low"), label: "Low", color: "#6b7280", weight: 0 },
    { key: priority("normal"), label: "Normal", color: "#3b82f6", weight: 10 },
    { key: priority("high"), label: "High", color: "#f59e0b", weight: 20 },
    { key: priority("urgent"), label: "Urgent", color: "#ef4444", weight: 30 },
  ],
  transitions: [
    { from: status("open"), to: status("in_progress") },
    { from: status("open"), to: status("closed") },
    { from: status("in_progress"), to: status("waiting_on_customer") },
    { from: status("in_progress"), to: status("resolved") },
    { from: status("in_progress"), to: status("open") },
    { from: status("waiting_on_customer"), to: status("in_progress") },
    { from: status("waiting_on_customer"), to: status("resolved") },
    { from: status("resolved"), to: status("closed") },
    { from: status("resolved"), to: status("in_progress") },
  ],
  types: [
    {
      key: type("question"),
      label: "Question",
      color: "#3b82f6",
      icon: "circle-help",
      defaultPriority: priority("normal"),
    },
    {
      key: type("bug"),
      label: "Bug",
      color: "#ef4444",
      icon: "bug",
      defaultPriority: priority("high"),
    },
    {
      key: type("feature_request"),
      label: "Feature Request",
      color: "#10b981",
      icon: "lightbulb",
      defaultPriority: priority("low"),
    },
    {
      key: type("incident"),
      label: "Incident",
      color: "#dc2626",
      icon: "siren",
      defaultPriority: priority("urgent"),
    },
  ],
  tags: [
    { key: tag("billing"), label: "Billing", color: "#a855f7" },
    { key: tag("vip"), label: "VIP", color: "#fbbf24" },
    { key: tag("regression"), label: "Regression", color: "#dc2626" },
  ],
  defaultStatus: status("open"),
  defaultPriority: priority("normal"),
  defaultTypeKey: null as TicketType | null,
} as const
