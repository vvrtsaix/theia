import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"
import {
  Workflow,
  WorkflowPriority,
  WorkflowStatus,
  WorkflowTag,
  WorkflowTransition,
  WorkflowType,
} from "#entities/Workflow"
import {
  Forbidden,
  InfrastructureError,
  NoActiveTenant,
  NotFound,
  Unauthorized,
  ValidationError,
} from "#errors"

const AuthErrors = [Unauthorized, NoActiveTenant, Forbidden, InfrastructureError] as const

/**
 * Workflow management — admin-only.
 *
 * All mutations require `workflow:update` permission. The TicketEntity actor
 * reads the resulting Workflow on its next mailbox message and validates
 * subsequent writes against it.
 *
 * Removing a status/priority/type/tag is allowed only if no in-flight ticket
 * holds it (server enforces; raises `ValidationError`).
 */
export const WorkflowRpc = RpcGroup.make(
  Rpc.make("workflow.get", {
    success: Workflow,
    error: Schema.Union([...AuthErrors, NotFound]),
  }),

  // ─── statuses ─────────────────────────────────────────────────────────────
  Rpc.make("workflow.addStatus", {
    payload: { status: WorkflowStatus },
    success: Workflow,
    error: Schema.Union([...AuthErrors, ValidationError, NotFound]),
  }),
  Rpc.make("workflow.updateStatus", {
    payload: { status: WorkflowStatus },
    success: Workflow,
    error: Schema.Union([...AuthErrors, ValidationError, NotFound]),
  }),
  Rpc.make("workflow.removeStatus", {
    payload: { key: WorkflowStatus.fields.key },
    success: Workflow,
    error: Schema.Union([...AuthErrors, ValidationError, NotFound]),
  }),

  // ─── priorities ───────────────────────────────────────────────────────────
  Rpc.make("workflow.addPriority", {
    payload: { priority: WorkflowPriority },
    success: Workflow,
    error: Schema.Union([...AuthErrors, ValidationError, NotFound]),
  }),
  Rpc.make("workflow.updatePriority", {
    payload: { priority: WorkflowPriority },
    success: Workflow,
    error: Schema.Union([...AuthErrors, ValidationError, NotFound]),
  }),
  Rpc.make("workflow.removePriority", {
    payload: { key: WorkflowPriority.fields.key },
    success: Workflow,
    error: Schema.Union([...AuthErrors, ValidationError, NotFound]),
  }),

  // ─── transitions ──────────────────────────────────────────────────────────
  Rpc.make("workflow.setTransitions", {
    payload: { transitions: Schema.Array(WorkflowTransition) },
    success: Workflow,
    error: Schema.Union([...AuthErrors, ValidationError, NotFound]),
  }),

  // ─── types ────────────────────────────────────────────────────────────────
  Rpc.make("workflow.addType", {
    payload: { type: WorkflowType },
    success: Workflow,
    error: Schema.Union([...AuthErrors, ValidationError, NotFound]),
  }),
  Rpc.make("workflow.updateType", {
    payload: { type: WorkflowType },
    success: Workflow,
    error: Schema.Union([...AuthErrors, ValidationError, NotFound]),
  }),
  Rpc.make("workflow.removeType", {
    payload: { key: WorkflowType.fields.key },
    success: Workflow,
    error: Schema.Union([...AuthErrors, ValidationError, NotFound]),
  }),

  // ─── tags ─────────────────────────────────────────────────────────────────
  Rpc.make("workflow.addTag", {
    payload: { tag: WorkflowTag },
    success: Workflow,
    error: Schema.Union([...AuthErrors, ValidationError, NotFound]),
  }),
  Rpc.make("workflow.updateTag", {
    payload: { tag: WorkflowTag },
    success: Workflow,
    error: Schema.Union([...AuthErrors, ValidationError, NotFound]),
  }),
  Rpc.make("workflow.removeTag", {
    payload: { key: WorkflowTag.fields.key },
    success: Workflow,
    error: Schema.Union([...AuthErrors, ValidationError, NotFound]),
  }),

  Rpc.make("workflow.setDefaults", {
    payload: {
      defaultStatus: WorkflowStatus.fields.key,
      defaultPriority: WorkflowPriority.fields.key,
      defaultTypeKey: Schema.NullOr(WorkflowType.fields.key),
    },
    success: Workflow,
    error: Schema.Union([...AuthErrors, ValidationError, NotFound]),
  }),
)
