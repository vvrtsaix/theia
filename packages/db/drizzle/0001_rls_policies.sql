-- ────────────────────────────────────────────────────────────────────────────
-- RLS policies. Custom migration — runs after `0000_init.sql` creates tables.
--
-- Tables WITHOUT RLS (intentional):
--   - better-auth: user, session, account, verification, organization,
--     member, invitation, organization_role
--   - system: system_config (system-wide; access gated by super-admin perms)
--
-- Pattern per tenant-scoped table:
--   1. ENABLE + FORCE ROW LEVEL SECURITY
--   2. CREATE POLICY <table>_tenant_isolation
--      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
--      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
--   3. GRANT DML TO app_user
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE workflow ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE workflow FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY workflow_tenant_isolation ON workflow
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON workflow TO app_user;--> statement-breakpoint

ALTER TABLE ticket ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ticket FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY ticket_tenant_isolation ON ticket
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ticket TO app_user;--> statement-breakpoint

ALTER TABLE ticket_event ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ticket_event FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY ticket_event_tenant_isolation ON ticket_event
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
GRANT SELECT, INSERT ON ticket_event TO app_user;--> statement-breakpoint

ALTER TABLE ticket_participant ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ticket_participant FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY ticket_participant_tenant_isolation ON ticket_participant
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ticket_participant TO app_user;--> statement-breakpoint

ALTER TABLE ticket_tag_assignment ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ticket_tag_assignment FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY ticket_tag_assignment_tenant_isolation ON ticket_tag_assignment
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON ticket_tag_assignment TO app_user;--> statement-breakpoint

ALTER TABLE notification ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE notification FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY notification_tenant_isolation ON notification
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON notification TO app_user;--> statement-breakpoint

-- system_config: super-admin gated at the application layer; read for all,
-- write only by super-admin. No RLS (system-wide table).
GRANT SELECT, INSERT, UPDATE, DELETE ON system_config TO app_user;--> statement-breakpoint

-- better-auth-owned tables: NO RLS, GRANT full DML.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "user", "session", "account", "verification",
  organization, member, invitation, organization_role
  TO app_user;
