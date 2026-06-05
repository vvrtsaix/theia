import { defineConfig } from "drizzle-kit"

/**
 * Drizzle-kit config. Migrations land in `./drizzle/` and are version-
 * controlled. Production runs them via `drizzle-kit migrate`; tests use a
 * temporary Pg container.
 *
 * DATABASE_URL is read at migrate time only. The Effect SqlClient layer
 * (see src/runtime/PgLive.ts) reads it via `Config.redacted("DATABASE_URL")`.
 */
export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://theia:theia@localhost:5432/theia",
  },
  casing: "snake_case",
  strict: true,
  verbose: true,
})
