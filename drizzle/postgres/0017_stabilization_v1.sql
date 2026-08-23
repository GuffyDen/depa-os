-- DEPA OS Stabilization v1. Additive safety controls plus removal of two exact duplicate indexes.
CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Audit records are immutable';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='audit_logs'::regclass AND tgname='audit_logs_immutable_update' AND NOT tgisinternal) THEN
    CREATE TRIGGER audit_logs_immutable_update BEFORE UPDATE ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='audit_logs'::regclass AND tgname='audit_logs_immutable_delete' AND NOT tgisinternal) THEN
    CREATE TRIGGER audit_logs_immutable_delete BEFORE DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='client_portal_audit_events'::regclass AND tgname='client_portal_audit_events_immutable_update' AND NOT tgisinternal) THEN
    CREATE TRIGGER client_portal_audit_events_immutable_update BEFORE UPDATE ON client_portal_audit_events FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='client_portal_audit_events'::regclass AND tgname='client_portal_audit_events_immutable_delete' AND NOT tgisinternal) THEN
    CREATE TRIGGER client_portal_audit_events_immutable_delete BEFORE DELETE ON client_portal_audit_events FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
  END IF;
END $$;
--> statement-breakpoint
DROP INDEX IF EXISTS idx_leads_client;
--> statement-breakpoint
DROP INDEX IF EXISTS idx_orders_number;
