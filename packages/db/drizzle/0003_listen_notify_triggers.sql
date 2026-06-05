-- ────────────────────────────────────────────────────────────────────────────
-- Pg LISTEN/NOTIFY triggers for real-time event push.
--
-- `ticket_event_inserted` channel fires after each INSERT into ticket_event.
-- Payload is the event JSONB (the full domain TicketEvent).
--
-- `notification_inserted` channel fires after each INSERT into notification.
-- Payload is `{id, recipient_id}` so consumers can route to the user's stream.
--
-- Consumers (`@theia/cluster-entities` real-time tailer + the
-- @theia/rpc-server notification.stream handler) subscribe via
-- `postgres-js` `listen()` and re-emit on the Effect Stream.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION notify_ticket_event_inserted() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('ticket_event_inserted', NEW.event::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER ticket_event_inserted_notify
  AFTER INSERT ON ticket_event
  FOR EACH ROW
  EXECUTE FUNCTION notify_ticket_event_inserted();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION notify_notification_inserted() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'notification_inserted',
    json_build_object('id', NEW.id, 'recipient_id', NEW.recipient_id)::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER notification_inserted_notify
  AFTER INSERT ON notification
  FOR EACH ROW
  EXECUTE FUNCTION notify_notification_inserted();
