-- ────────────────────────────────────────────────────────────────────────────
-- Phase 9 polish: full-text + trigram search on ticket.
-- ────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

ALTER TABLE ticket
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) STORED;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS ticket_search_vector_idx
  ON ticket USING gin (search_vector);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS ticket_title_trgm_idx
  ON ticket USING gin (title gin_trgm_ops);

-- (DML grants on `ticket` already exist in `0001_rls_policies.sql`.)
