-- Convert `organization_role.permission` from JSONB to TEXT.
--
-- better-auth's `hasPermission` runtime calls `JSON.parse(permissionsString)`
-- on the value it reads back; Drizzle returns JSONB columns pre-parsed as JS
-- objects, which would surface as `JSON.parse([object Object])` errors. TEXT
-- keeps the serialized JSON pass-through.
ALTER TABLE "organization_role"
  ALTER COLUMN "permission" SET DATA TYPE text USING "permission"::text;
