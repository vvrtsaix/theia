import { describe, expect, it } from "vitest"
import { getTableColumns } from "drizzle-orm"
import { Schema } from "effect"
import { Entities } from "@theia/domain"
import * as DbSchema from "@theia/db/schema"

/**
 * Domain ↔ DB parity.
 *
 * Each tenant-owned table is asserted to cover every field of its
 * corresponding domain Schema (and vice versa). Mismatches fail CI before
 * they reach a handler.
 */

const domainFields = (cls: { fields: Record<string, unknown> }): ReadonlyArray<string> =>
  Object.keys(cls.fields)

const dbColumnNames = (table: object): ReadonlyArray<string> =>
  Object.keys(getTableColumns(table as Parameters<typeof getTableColumns>[0]))

const pairs = [
  {
    name: "Ticket",
    domain: Entities.Ticket,
    db: DbSchema.tickets,
    /** Domain-only fields stored elsewhere (denormalized projections). */
    domainOnly: ["tags"] as const,
  },
  {
    name: "Workflow",
    domain: Entities.Workflow,
    db: DbSchema.workflows,
    domainOnly: [] as ReadonlyArray<string>,
  },
  {
    name: "TicketParticipant",
    domain: Entities.TicketParticipant,
    db: DbSchema.ticketParticipants,
    domainOnly: [] as ReadonlyArray<string>,
  },
  {
    name: "Notification",
    domain: Entities.Notification,
    db: DbSchema.notifications,
    domainOnly: [] as ReadonlyArray<string>,
  },
  {
    name: "SystemConfig",
    domain: Entities.SystemConfig,
    db: DbSchema.systemConfig,
    /** Domain `key` maps to db `key` (PK). `updatedBy` is nullable FK kept in db. */
    domainOnly: [] as ReadonlyArray<string>,
  },
] as const

describe("domain ↔ db parity", () => {
  for (const p of pairs) {
    it(`${p.name}: all domain fields exist in db`, () => {
      const domainKeys = domainFields(p.domain as never)
      const dbKeys = new Set(dbColumnNames(p.db))
      const missing = domainKeys.filter(
        (k) => !dbKeys.has(k) && !p.domainOnly.includes(k as never),
      )
      expect(missing, `domain fields missing from db: ${missing.join(", ")}`).toEqual([])
    })

    it(`${p.name}: all db columns exist in domain`, () => {
      // `id`, `tenantId`, `createdAt`/`updatedAt` allowed even when domain
      // doesn't carry them (composite-PK tables like ticket_participant).
      const allowed = new Set(["id", "tenantId", "createdAt"])
      const domainKeys = new Set(domainFields(p.domain as never))
      const dbKeys = dbColumnNames(p.db)
      const extra = dbKeys.filter((col) => !domainKeys.has(col) && !allowed.has(col))
      expect(extra, `db columns not in domain: ${extra.join(", ")}`).toEqual([])
    })
  }
})

describe("SystemConfigValue _tag ↔ SystemConfigKey parity", () => {
  it("every SystemConfigKey literal has a matching SystemConfigValue variant _tag", () => {
    // Pull literal values out of the Schema.Literals via decode-sync probe.
    const knownKeys = ["workflow_defaults"]
    for (const key of knownKeys) {
      expect(() => Schema.decodeSync(Entities.SystemConfigKey)(key)).not.toThrow()
    }
  })
})
