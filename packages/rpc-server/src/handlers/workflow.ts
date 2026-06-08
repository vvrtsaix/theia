import { CurrentSession, Database, Schema as DbSchema, type DrizzleTx } from "@theia/db"
import { Rpc as DomainRpc, Entities, Errors } from "@theia/domain"
import { eq } from "drizzle-orm"
import { DateTime, Effect, Schema } from "effect"

/**
 * Workflow handlers — Drizzle query builder, all queries inside
 * `Database.tx` so RLS isolates rows automatically.
 *
 * Workflow rows are 1:1 with tenants; there is no "create workflow" RPC —
 * the row is seeded at tenant creation from `system_config.workflow_defaults`.
 *
 * Mutation invariants enforced at handler time (before DB write):
 *   1. At least one status with `terminal: true`.
 *   2. `defaultStatus`/`defaultPriority`/`defaultTypeKey` (if set) must
 *      exist in their respective arrays.
 *   3. Cannot remove the default status / priority / type.
 */

type WorkflowRow = typeof DbSchema.workflows.$inferSelect

const decodeWorkflow = (row: WorkflowRow) =>
  Schema.decodeUnknownEffect(Entities.Workflow)({
    tenantId: row.tenantId,
    statuses: row.statuses,
    priorities: row.priorities,
    transitions: row.transitions,
    types: row.types,
    tags: row.tags,
    defaultStatus: row.defaultStatus,
    defaultPriority: row.defaultPriority,
    defaultTypeKey: row.defaultTypeKey,
    updatedAt: row.updatedAt.toISOString(),
  }).pipe(
    Effect.catchTag("SchemaError", (e) =>
      Effect.die(new Error(`workflow row failed domain decode: ${String(e)}`)),
    ),
  )

interface NextWorkflow {
  statuses: ReadonlyArray<Entities.WorkflowStatus>
  priorities: ReadonlyArray<Entities.WorkflowPriority>
  transitions: ReadonlyArray<Entities.WorkflowTransition>
  types: ReadonlyArray<Entities.WorkflowType>
  tags: ReadonlyArray<Entities.WorkflowTag>
  defaultStatus: Entities.TicketStatus
  defaultPriority: Entities.TicketPriority
  defaultTypeKey: Entities.TicketType | null
}

const fetchWorkflow = (tx: DrizzleTx, tenantId: string) =>
  tx.select().from(DbSchema.workflows).where(eq(DbSchema.workflows.tenantId, tenantId)).limit(1)

const validateInvariants = (next: NextWorkflow): Errors.ValidationError | null => {
  if (!next.statuses.some((s) => s.terminal)) {
    return new Errors.ValidationError({
      field: "statuses",
      message: "at least one status must be terminal",
    })
  }
  if (!next.statuses.some((s) => s.key === next.defaultStatus)) {
    return new Errors.ValidationError({
      field: "defaultStatus",
      message: "defaultStatus not in statuses",
    })
  }
  if (!next.priorities.some((p) => p.key === next.defaultPriority)) {
    return new Errors.ValidationError({
      field: "defaultPriority",
      message: "defaultPriority not in priorities",
    })
  }
  if (next.defaultTypeKey && !next.types.some((t) => t.key === next.defaultTypeKey)) {
    return new Errors.ValidationError({
      field: "defaultTypeKey",
      message: "defaultTypeKey not in types",
    })
  }
  return null
}

const replaceWhere = <A, K extends keyof A>(xs: ReadonlyArray<A>, key: K, item: A) => {
  let found = false
  const out = xs.map((x) => {
    if (x[key] === item[key]) {
      found = true
      return item
    }
    return x
  })
  return found ? out : null
}

/** Apply a delta to the current workflow then persist. */
const mutate = (
  apply: (
    current: Entities.Workflow,
  ) => NextWorkflow | Effect.Effect<never, Errors.ValidationError | Errors.NotFound>,
) =>
  Effect.gen(function* () {
    const db = yield* Database
    const session = yield* CurrentSession
    const now = yield* DateTime.now

    const result = yield* db.tx(async (tx) => {
      const rows = await fetchWorkflow(tx, session.activeOrganizationId)
      if (rows.length === 0) return { kind: "not_found" as const }
      const row = rows[0]!
      return { kind: "row" as const, row }
    })

    if (result.kind === "not_found") {
      return yield* new Errors.NotFound({
        resource: "workflow",
        id: session.activeOrganizationId,
      })
    }

    const current = yield* decodeWorkflow(result.row)
    const applied = apply(current)
    if (Effect.isEffect(applied)) {
      return yield* applied
    }

    const invariantError = validateInvariants(applied)
    if (invariantError) return yield* invariantError

    const updatedRow = yield* db.tx(async (tx) => {
      const updated = await tx
        .update(DbSchema.workflows)
        .set({
          statuses: applied.statuses,
          priorities: applied.priorities,
          transitions: applied.transitions,
          types: applied.types,
          tags: applied.tags,
          defaultStatus: applied.defaultStatus,
          defaultPriority: applied.defaultPriority,
          defaultTypeKey: applied.defaultTypeKey,
          updatedAt: DateTime.toDate(now),
        })
        .where(eq(DbSchema.workflows.tenantId, session.activeOrganizationId))
        .returning()
      return updated[0] ?? null
    })

    if (!updatedRow) {
      return yield* new Errors.NotFound({
        resource: "workflow",
        id: session.activeOrganizationId,
      })
    }
    return yield* decodeWorkflow(updatedRow)
  })

export const WorkflowHandlers = DomainRpc.WorkflowRpc.toLayer({
  "workflow.get": () =>
    Effect.gen(function* () {
      const db = yield* Database
      const session = yield* CurrentSession
      const rows = yield* db.tx((tx) => fetchWorkflow(tx, session.activeOrganizationId))
      if (rows.length === 0) {
        return yield* new Errors.NotFound({
          resource: "workflow",
          id: session.activeOrganizationId,
        })
      }
      return yield* decodeWorkflow(rows[0]!)
    }),

  "workflow.addStatus": (payload) =>
    mutate((w) => {
      if (w.statuses.some((s) => s.key === payload.status.key)) {
        return Effect.fail(
          new Errors.ValidationError({
            field: "status",
            message: `status ${payload.status.key} already exists`,
          }),
        )
      }
      return { ...w, statuses: [...w.statuses, payload.status] }
    }),

  "workflow.updateStatus": (payload) =>
    mutate((w) => {
      const next = replaceWhere(w.statuses, "key", payload.status)
      if (!next) {
        return Effect.fail(
          new Errors.NotFound({ resource: "workflow.status", id: payload.status.key }),
        )
      }
      return { ...w, statuses: next }
    }),

  "workflow.removeStatus": (payload) =>
    mutate((w) => {
      if (w.defaultStatus === payload.key) {
        return Effect.fail(
          new Errors.ValidationError({
            field: "status",
            message: "cannot remove the default status",
          }),
        )
      }
      return {
        ...w,
        statuses: w.statuses.filter((s) => s.key !== payload.key),
        transitions: w.transitions.filter((t) => t.from !== payload.key && t.to !== payload.key),
      }
    }),

  "workflow.addPriority": (payload) =>
    mutate((w) => {
      if (w.priorities.some((p) => p.key === payload.priority.key)) {
        return Effect.fail(
          new Errors.ValidationError({
            field: "priority",
            message: `priority ${payload.priority.key} already exists`,
          }),
        )
      }
      return { ...w, priorities: [...w.priorities, payload.priority] }
    }),

  "workflow.updatePriority": (payload) =>
    mutate((w) => {
      const next = replaceWhere(w.priorities, "key", payload.priority)
      if (!next) {
        return Effect.fail(
          new Errors.NotFound({ resource: "workflow.priority", id: payload.priority.key }),
        )
      }
      return { ...w, priorities: next }
    }),

  "workflow.removePriority": (payload) =>
    mutate((w) => {
      if (w.defaultPriority === payload.key) {
        return Effect.fail(
          new Errors.ValidationError({
            field: "priority",
            message: "cannot remove the default priority",
          }),
        )
      }
      return { ...w, priorities: w.priorities.filter((p) => p.key !== payload.key) }
    }),

  "workflow.setTransitions": (payload) =>
    mutate((w) => ({ ...w, transitions: [...payload.transitions] })),

  "workflow.addType": (payload) =>
    mutate((w) => {
      if (w.types.some((t) => t.key === payload.type.key)) {
        return Effect.fail(
          new Errors.ValidationError({
            field: "type",
            message: `type ${payload.type.key} already exists`,
          }),
        )
      }
      return { ...w, types: [...w.types, payload.type] }
    }),

  "workflow.updateType": (payload) =>
    mutate((w) => {
      const next = replaceWhere(w.types, "key", payload.type)
      if (!next) {
        return Effect.fail(new Errors.NotFound({ resource: "workflow.type", id: payload.type.key }))
      }
      return { ...w, types: next }
    }),

  "workflow.removeType": (payload) =>
    mutate((w) => {
      if (w.defaultTypeKey === payload.key) {
        return Effect.fail(
          new Errors.ValidationError({
            field: "type",
            message: "cannot remove the default type",
          }),
        )
      }
      return { ...w, types: w.types.filter((t) => t.key !== payload.key) }
    }),

  "workflow.addTag": (payload) =>
    mutate((w) => {
      if (w.tags.some((t) => t.key === payload.tag.key)) {
        return Effect.fail(
          new Errors.ValidationError({
            field: "tag",
            message: `tag ${payload.tag.key} already exists`,
          }),
        )
      }
      return { ...w, tags: [...w.tags, payload.tag] }
    }),

  "workflow.updateTag": (payload) =>
    mutate((w) => {
      const next = replaceWhere(w.tags, "key", payload.tag)
      if (!next) {
        return Effect.fail(new Errors.NotFound({ resource: "workflow.tag", id: payload.tag.key }))
      }
      return { ...w, tags: next }
    }),

  "workflow.removeTag": (payload) =>
    mutate((w) => ({ ...w, tags: w.tags.filter((t) => t.key !== payload.key) })),

  "workflow.setDefaults": (payload) =>
    mutate((w) => ({
      ...w,
      defaultStatus: payload.defaultStatus,
      defaultPriority: payload.defaultPriority,
      defaultTypeKey: payload.defaultTypeKey,
    })),
})
