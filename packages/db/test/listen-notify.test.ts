import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * Pg LISTEN/NOTIFY round-trip — integration test.
 *
 * Insert into `ticket_event` → `ticket_event_inserted` channel fires →
 * dedicated listener connection receives the payload. Confirms migration
 * 0003's trigger is correctly installed.
 *
 * Skips when `DATABASE_URL` is not present.
 */

const url = process.env.DATABASE_URL
const skip = !url

describe.skipIf(skip)("LISTEN/NOTIFY — ticket_event_inserted", () => {
  let writer: ReturnType<typeof postgres>
  let listener: ReturnType<typeof postgres>
  const tenantId = crypto.randomUUID()
  const userId = crypto.randomUUID()
  const ticketId = crypto.randomUUID()

  beforeAll(async () => {
    writer = postgres(url as string, {
      max: 2,
      connection: { application_name: "theia-notify-test-writer" },
    })
    listener = postgres(url as string, {
      max: 1,
      connection: { application_name: "theia-notify-test-listener" },
    })

    const db = drizzle(writer, { casing: "snake_case" })
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, created_at)
      VALUES (${tenantId}, 'X', ${`x-${tenantId.slice(0, 8)}`}, NOW())
      ON CONFLICT DO NOTHING
    `)
    await db.execute(sql`
      INSERT INTO "user" (id, email, name, email_verified, created_at, updated_at)
      VALUES (${userId}, ${`u-${userId}@test`}, 'U', true, NOW(), NOW())
      ON CONFLICT DO NOTHING
    `)
    await db.execute(sql`
      INSERT INTO workflow (tenant_id, statuses, priorities, types, tags, transitions, default_status, default_priority, default_type_key, updated_at)
      VALUES (${tenantId}, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'open', 'medium', NULL, NOW())
      ON CONFLICT (tenant_id) DO NOTHING
    `)
    await db.execute(sql`
      INSERT INTO ticket (id, tenant_id, title, description, status, priority, type_key, assignee_id, reporter_id, version, created_at, updated_at)
      VALUES (${ticketId}, ${tenantId}, 'Notify test', '', 'open', 'medium', NULL, NULL, ${userId}, 1, NOW(), NOW())
    `)
  })

  afterAll(async () => {
    const db = drizzle(writer, { casing: "snake_case" })
    await db.execute(sql`DELETE FROM ticket_event WHERE ticket_id = ${ticketId}`)
    await db.execute(sql`DELETE FROM ticket WHERE id = ${ticketId}`)
    await db.execute(sql`DELETE FROM workflow WHERE tenant_id = ${tenantId}`)
    await db.execute(sql`DELETE FROM organization WHERE id = ${tenantId}`)
    await db.execute(sql`DELETE FROM "user" WHERE id = ${userId}`)
    await listener.end({ timeout: 5 })
    await writer.end({ timeout: 5 })
  })

  it("emits ticket_event_inserted on insert", async () => {
    const received: Array<string> = []
    const req = await listener.listen("ticket_event_inserted", (payload) => {
      received.push(payload)
    })

    // Insert one event row. The pg_notify trigger should fire synchronously
    // on commit and the listener should receive it within milliseconds.
    const event = {
      _tag: "TicketOpened",
      eventId: crypto.randomUUID(),
      ticketId,
      tenantId,
      occurredAt: new Date().toISOString(),
      version: 1,
      v: 1,
      reporterId: userId,
      title: "Notify test",
      description: "",
      priority: "medium",
      typeKey: null,
    }
    const db = drizzle(writer, { casing: "snake_case" })
    await db.execute(sql`
      INSERT INTO ticket_event (tenant_id, ticket_id, version, event, occurred_at)
      VALUES (${tenantId}, ${ticketId}, 1, ${JSON.stringify(event)}::jsonb, NOW())
    `)

    // Wait up to 2s for delivery.
    const deadline = Date.now() + 2000
    while (received.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50))
    }

    await req.unlisten()
    expect(received.length).toBeGreaterThan(0)
    const parsed = JSON.parse(received[0] as string)
    expect(parsed._tag).toBe("TicketOpened")
    expect(parsed.ticketId).toBe(ticketId)
  })
})
