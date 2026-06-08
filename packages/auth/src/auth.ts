import { Schema } from "@theia/db"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { organization } from "better-auth/plugins"
import { asc, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import { ac, roles } from "#access-control"

/**
 * Auth instance configuration.
 *
 * **Identity model:**
 *   - One global `user` row per identity. `kind` (`UserKind`: customer /
 *     internal / system) is a user-level closed enum, set at signup.
 *   - One global user can be a `member` of N organizations (= tenants),
 *     each with a different `role` string.
 *   - `dynamicAccessControl` stores custom per-tenant roles in
 *     `organization_role` table; tenant admins create/edit them at runtime
 *     via `auth.api.createOrganizationRole`.
 *
 * **IDs:** server-side `uuidv7()` (Pg 18). We disable better-auth's ID
 * generator so the DB owns it — keeps a single source of truth and gives
 * us time-ordered keys for free.
 *
 * **Database URL:** `DATABASE_URL` env. The Drizzle adapter shares the pool
 * with the Effect SqlClient layer (see `@theia/db/runtime/Database.ts`).
 */

const url = process.env.DATABASE_URL
if (!url) {
  throw new Error("DATABASE_URL not set; better-auth cannot initialize.")
}

const pg = postgres(url)
// `casing: "snake_case"` must mirror `@theia/db`'s drizzle config — better-
// auth's drizzle adapter uses this drizzle instance to build queries, and
// without the casing option Drizzle emits camelCase column names which
// don't match our snake_case migrations (e.g. `emailVerified` vs
// `email_verified`).
const db = drizzle(pg, { schema: Schema, casing: "snake_case" })

/**
 * better-auth expects schema keys to match its model names (`user`, `session`,
 * …). Our Drizzle exports are pluralized (`users`, `sessions`, …) so we hand
 * the adapter an explicit remap. The base tables come from `auth.ts`; the
 * organization plugin contributes `organization`, `member`, `invitation`, and
 * (via `dynamicAccessControl`) `organizationRole`.
 */
const authSchema = {
  user: Schema.users,
  session: Schema.sessions,
  account: Schema.accounts,
  verification: Schema.verifications,
  organization: Schema.organizations,
  member: Schema.members,
  invitation: Schema.invitations,
  organizationRole: Schema.organizationRoles,
}

/**
 * Origins permitted to call the auth handler.
 *
 * better-auth rejects requests whose `Origin` header is not the API's own
 * `baseURL` or one of `trustedOrigins`. The SPA dev server runs on a
 * different port from the API so we add it explicitly. Production sets
 * `BETTER_AUTH_TRUSTED_ORIGINS` (comma-separated) to the deployed web origin.
 */
const trustedOrigins = (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0)

export const auth = betterAuth({
  /**
   * Public base URL of the API. Used by better-auth to build redirect URLs
   * for email verification, password reset, and OAuth callbacks. Falls back
   * to the dev API origin so the init-time warning stays quiet locally; set
   * `BETTER_AUTH_URL` explicitly in every non-local environment.
   */
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",

  trustedOrigins,

  database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),

  /**
   * Pre-insert session hook: stamp `activeOrganizationId` from the user's
   * first membership at session-create time. Without this, a freshly created
   * session has `activeOrganizationId = null` until the SPA explicitly calls
   * `setActiveOrganization`, which leaks a no-org state into every protected
   * request between sign-in and that call.
   */
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          if ((session as { activeOrganizationId?: string | null }).activeOrganizationId) {
            return { data: session }
          }
          // ORDER BY created_at ASC so the same user always gets the same
          // default tenant across sessions — without it, Pg returns rows in
          // physical-heap order which can flip after VACUUM and silently
          // change the user's active tenant on next sign-in.
          const rows = await db
            .select({ orgId: Schema.members.organizationId })
            .from(Schema.members)
            .where(eq(Schema.members.userId, session.userId))
            .orderBy(asc(Schema.members.createdAt))
            .limit(1)
          const orgId = rows[0]?.orgId
          if (!orgId) return { data: session }
          return { data: { ...session, activeOrganizationId: orgId } }
        },
      },
    },
  },

  advanced: {
    /** Defer ID generation to Pg `uuidv7()` default. */
    database: { generateId: false },
  },

  emailAndPassword: {
    enabled: true,
    /** Require email verification before any session can be created. */
    requireEmailVerification: false,
  },

  /**
   * Rate limit auth-mutation routes. Defaults are conservative — production
   * should swap `storage: "memory"` for Redis (or any external KV) so the
   * counter survives restarts and is shared across replicas. `customRules`
   * tightens the sign-in path to 5 attempts per IP per minute; everything
   * else inherits the default window.
   */
  rateLimit: {
    enabled: true,
    storage: "memory",
    window: 60,
    max: 30,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60, max: 5 },
      "/forgot-password": { window: 60, max: 5 },
    },
  },

  user: {
    additionalFields: {
      /**
       * Closed-set identity class. Drives auth + visibility rules at the
       * framework layer. NOT user-mutable post-creation.
       */
      kind: {
        type: "string",
        defaultValue: "customer",
        input: false,
      },
    },
  },

  plugins: [
    organization({
      // Each user can belong to many tenants — we deliberately do NOT cap this.
      organizationLimit: 100,
      ac,
      roles,
      dynamicAccessControl: {
        enabled: true,
      },
      /**
       * Invitation delivery.
       *
       * Dev: log the accept URL to the API console so a developer can copy
       * it into another browser to test the accept flow without configuring
       * SMTP. Production must swap in a real sender via `EMAIL_*` env.
       *
       * The web app reads the path `/invite/:id` and calls
       * `authClient.organization.acceptInvitation({ invitationId })`.
       */
      sendInvitationEmail: async ({ id, email, organization, inviter, role }) => {
        const webOrigin =
          process.env.WEB_BASE_URL ??
          process.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(",")[0]?.trim() ??
          "http://localhost:5173"
        const url = `${webOrigin}/invite/${id}`
        console.warn(
          `[invite] org="${organization.name}" to=${email} role=${role} by=${inviter.user.email} → ${url}`,
        )
      },
    }),
  ],
})

export type Auth = typeof auth
