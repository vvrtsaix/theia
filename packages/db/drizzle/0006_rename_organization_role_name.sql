-- Rename `organization_role.name` → `organization_role.role` so the better-
-- auth `dynamicAccessControl` plugin resolves its `role` field directly
-- against the underlying column. Authored manually because drizzle-kit's
-- generate prompts a TTY for rename vs drop+add disambiguation.
ALTER TABLE "organization_role" RENAME COLUMN "name" TO "role";
