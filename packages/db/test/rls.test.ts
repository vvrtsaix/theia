import * as DbSchema from "@theia/db/schema"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * Postgres RLS isolation — integration test.
 *
 * Two tenants, each with one ticket. A transaction bound to tenant A must
 * not see tenant B's rows even via raw SELECT — the RLS policy on `ticket`
 * (`USING (tenant_id = current_setting('app.tenant_id', true)::uuid)`) is
 * what enforces this; the test will fail if migrations regress.
 *
 * Skips when `DATABASE_URL` is not present so unit-test-only runs stay
 * fast. CI sets the env; local dev sets it in `.env.local`.
 */

const url = process.env.DATABASE_URL
const skip = !url

describe.skipIf(skip)("RLS — multi-tenant isolation", () => {
  let sqlClient: ReturnType<typeof postgres>
  let db: ReturnType<typeof drizzle>
  const tenantA = crypto.randomUUID()
  const tenantB = crypto.randomUUID()
  const userA = crypto.randomUUID()
  const userB = crypto.randomUUID()

  beforeAll(async () => {
    sqlClient = postgres(url as string, {
      max: 2,
      connection: { application_name: "theia-rls-test" },
    })
    db = drizzle(sqlClient, { casing: "snake_case" })

    // Seed: 2 tenants, 2 users, 2 tickets — one row per tenant.
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, created_at)
      VALUES
        (${tenantA}, 'A', ${`a-${tenantA.slice(0, 8)}`}, NOW()),
        (${tenantB}, 'B', ${`b-${tenantB.slice(0, 8)}`}, NOW())
      ON CONFLICT DO NOTHING
    `)
    await db.execute(sql`
      INSERT INTO "user" (id, email, name, email_verified, created_at, updated_at)
      VALUES
        (${userA}, ${`a-${userA}@test`}, 'User A', true, NOW(), NOW()),
        (${userB}, ${`b-${userB}@test`}, 'User B', true, NOW(), NOW())
      ON CONFLICT DO NOTHING
    `)
    await db.execute(sql`
      INSERT INTO workflow (tenant_id, statuses, priorities, types, tags, transitions, default_status, default_priority, default_type_key, updated_at)
      VALUES
        (${tenantA}, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'open', 'medium', NULL, NOW()),
        (${tenantB}, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'open', 'medium', NULL, NOW())
      ON CONFLICT (tenant_id) DO NOTHING
    `)
    await db.execute(sql`
      INSERT INTO ticket (tenant_id, title, description, status, priority, type_key, assignee_id, reporter_id, version, created_at, updated_at)
      VALUES
        (${tenantA}, 'A-only', '', 'open', 'medium', NULL, NULL, ${userA}, 1, NOW(), NOW()),
        (${tenantB}, 'B-only', '', 'open', 'medium', NULL, NULL, ${userB}, 1, NOW(), NOW())
    `)
  })

  afterAll(async () => {
    await db.execute(sql`DELETE FROM ticket WHERE tenant_id IN (${tenantA}, ${tenantB})`)
    await db.execute(sql`DELETE FROM workflow WHERE tenant_id IN (${tenantA}, ${tenantB})`)
    await db.execute(sql`DELETE FROM organization WHERE id IN (${tenantA}, ${tenantB})`)
    await db.execute(sql`DELETE FROM "user" WHERE id IN (${userA}, ${userB})`)
    await sqlClient.end({ timeout: 5 })
  })

  it("sees only own tenant's rows when app.tenant_id is bound", async () => {
    const fromA = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantA}, true)`)
      return tx.select().from(DbSchema.tickets)
    })
    expect(fromA.length).toBe(1)
    expect(fromA[0]?.title).toBe("A-only")

    const fromB = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantB}, true)`)
      return tx.select().from(DbSchema.tickets)
    })
    expect(fromB.length).toBe(1)
    expect(fromB[0]?.title).toBe("B-only")
  })

  it("returns zero rows when app.tenant_id is unset", async () => {
    // `app_user` is NOBYPASSRLS — missing GUC means the policy's
    // `current_setting('app.tenant_id', true)::uuid` returns NULL, no rows match.
    const rows = await db.transaction(async (tx) => tx.select().from(DbSchema.tickets))
    // Filter to our test rows only; other rows may exist in the DB.
    const ours = rows.filter((r) => r.tenantId === tenantA || r.tenantId === tenantB)
    expect(ours.length).toBe(0)
  })
})
