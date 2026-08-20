ALTER TABLE clients ADD COLUMN IF NOT EXISTS phone_normalized text;
--> statement-breakpoint
ALTER TABLE clients ADD COLUMN IF NOT EXISTS secondary_phone text;
--> statement-breakpoint
ALTER TABLE clients ADD COLUMN IF NOT EXISTS email text;
--> statement-breakpoint
ALTER TABLE clients ADD COLUMN IF NOT EXISTS preferred_contact text;
--> statement-breakpoint
ALTER TABLE clients ADD COLUMN IF NOT EXISTS responsible_user_id text;
--> statement-breakpoint
ALTER TABLE clients ADD COLUMN IF NOT EXISTS archived_at integer;
--> statement-breakpoint
UPDATE clients SET phone = COALESCE(NULLIF(trim(phone), ''), 'Не указан'), phone_normalized = regexp_replace(COALESCE(phone, ''), '[^0-9]+', '', 'g') WHERE phone_normalized IS NULL;
--> statement-breakpoint
UPDATE clients c SET responsible_user_id = u.id FROM users u WHERE c.responsible_user_id IS NULL AND c.owner_employee_id = u.employee_id;
--> statement-breakpoint
UPDATE clients SET responsible_user_id = (SELECT id FROM users WHERE role = 'OWNER' AND status = 'ACTIVE' ORDER BY created_at LIMIT 1) WHERE responsible_user_id IS NULL;
--> statement-breakpoint
UPDATE clients SET source = 'OTHER' WHERE source IS NULL OR source NOT IN ('WEBSITE','FARPOST','AVITO','REFERRAL','OTHER');
--> statement-breakpoint
UPDATE clients SET status = CASE WHEN status = 'ARCHIVED' THEN 'ARCHIVED' ELSE 'ACTIVE' END;
--> statement-breakpoint
ALTER TABLE clients ALTER COLUMN phone SET NOT NULL;
--> statement-breakpoint
ALTER TABLE clients ALTER COLUMN phone_normalized SET NOT NULL;
--> statement-breakpoint
ALTER TABLE clients ALTER COLUMN source SET NOT NULL;
--> statement-breakpoint
ALTER TABLE clients ALTER COLUMN source SET DEFAULT 'OTHER';
--> statement-breakpoint
ALTER TABLE clients ALTER COLUMN responsible_user_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE clients ALTER COLUMN status SET DEFAULT 'ACTIVE';
--> statement-breakpoint
ALTER TABLE clients ADD CONSTRAINT clients_responsible_user_id_fkey FOREIGN KEY (responsible_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE clients ADD CONSTRAINT clients_source_check CHECK (source IN ('WEBSITE','FARPOST','AVITO','REFERRAL','OTHER'));
--> statement-breakpoint
ALTER TABLE clients ADD CONSTRAINT clients_status_check CHECK (status IN ('ACTIVE','ARCHIVED'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_clients_phone_normalized ON clients(phone_normalized);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_clients_responsible_status_created ON clients(responsible_user_id,status,created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_clients_source_status_created ON clients(source,status,created_at DESC);
