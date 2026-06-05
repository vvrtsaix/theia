-- ────────────────────────────────────────────────────────────────────────────
-- Instance-level bootstrap. Runs once on first DB init.
--
-- Mounted into the Postgres container at `/docker-entrypoint-initdb.d/` —
-- executed BEFORE the app connects. See `infra/docker-compose.yaml`.
--
-- Drizzle-kit owns schema migrations; this file owns DB-level setup
-- (CREATE ROLE) that doesn't belong in versioned schema migrations.
-- ────────────────────────────────────────────────────────────────────────────

-- Application role — never bypasses RLS. The Effect SqlClient connects as this.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN NOBYPASSRLS PASSWORD 'app_user';
  END IF;
END
$$;

-- Confirm Postgres 18+ (`uuidv7()` is native).
DO $$
BEGIN
  IF current_setting('server_version_num')::int < 180000 THEN
    RAISE EXCEPTION 'theia requires Postgres 18 or later (uuidv7 native). Detected %.', version();
  END IF;
END
$$;

-- Grant DB connect to app_user.
GRANT CONNECT ON DATABASE theia TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
