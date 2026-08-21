ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_client_id_clients_id_fk;
--> statement-breakpoint
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_owner_employee_id_employees_id_fk;
--> statement-breakpoint
ALTER TABLE leads ALTER COLUMN client_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE leads RENAME COLUMN client_id TO linked_client_id;
--> statement-breakpoint
ALTER TABLE leads RENAME COLUMN status TO stage;
--> statement-breakpoint
ALTER TABLE leads RENAME COLUMN notes TO comment;
--> statement-breakpoint
ALTER TABLE leads RENAME COLUMN next_action TO next_action_type;
--> statement-breakpoint
ALTER TABLE leads RENAME COLUMN next_contact_at TO next_action_at;
--> statement-breakpoint
ALTER TABLE leads ADD COLUMN name text;
--> statement-breakpoint
ALTER TABLE leads ADD COLUMN phone text;
--> statement-breakpoint
ALTER TABLE leads ADD COLUMN normalized_phone text;
--> statement-breakpoint
ALTER TABLE leads ADD COLUMN secondary_phone text;
--> statement-breakpoint
ALTER TABLE leads ADD COLUMN email text;
--> statement-breakpoint
ALTER TABLE leads ADD COLUMN preferred_contact text;
--> statement-breakpoint
ALTER TABLE leads ADD COLUMN responsible_user_id text;
--> statement-breakpoint
ALTER TABLE leads ADD COLUMN next_action_comment text;
--> statement-breakpoint
ALTER TABLE leads ADD COLUMN lost_reason text;
--> statement-breakpoint
ALTER TABLE leads ADD COLUMN lost_comment text;
--> statement-breakpoint
ALTER TABLE leads ADD COLUMN created_by_user_id text;
--> statement-breakpoint
ALTER TABLE leads ADD COLUMN closed_at integer;
--> statement-breakpoint
UPDATE leads l SET name=COALESCE(NULLIF(c.name,''),'Без имени'),phone=COALESCE(NULLIF(c.phone,''),'Не указан'),normalized_phone=regexp_replace(COALESCE(c.phone,''),'[^0-9]+','','g'),responsible_user_id=COALESCE((SELECT u.id FROM users u WHERE u.employee_id=l.owner_employee_id LIMIT 1),(SELECT id FROM users WHERE role='OWNER' AND status='ACTIVE' ORDER BY created_at LIMIT 1)),created_by_user_id=COALESCE((SELECT u.id FROM users u WHERE u.employee_id=l.owner_employee_id LIMIT 1),(SELECT id FROM users WHERE role='OWNER' AND status='ACTIVE' ORDER BY created_at LIMIT 1)),stage=CASE WHEN stage IN ('NEW','CONTACTED','INSPECTION','CALCULATION','PROPOSAL','CONTRACT','WON','LOST') THEN stage ELSE 'NEW' END FROM clients c WHERE c.id=l.linked_client_id;
--> statement-breakpoint
ALTER TABLE leads ALTER COLUMN name SET NOT NULL;
--> statement-breakpoint
ALTER TABLE leads ALTER COLUMN phone SET NOT NULL;
--> statement-breakpoint
ALTER TABLE leads ALTER COLUMN normalized_phone SET NOT NULL;
--> statement-breakpoint
ALTER TABLE leads ALTER COLUMN responsible_user_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE leads ALTER COLUMN created_by_user_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE leads ALTER COLUMN stage SET DEFAULT 'NEW';
--> statement-breakpoint
ALTER TABLE leads ADD CONSTRAINT leads_linked_client_id_fkey FOREIGN KEY (linked_client_id) REFERENCES clients(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE leads ADD CONSTRAINT leads_responsible_user_id_fkey FOREIGN KEY (responsible_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE leads ADD CONSTRAINT leads_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE leads ADD CONSTRAINT leads_source_check CHECK (source IN ('WEBSITE','FARPOST','AVITO','REFERRAL','OTHER'));
--> statement-breakpoint
ALTER TABLE leads ADD CONSTRAINT leads_stage_check CHECK (stage IN ('NEW','CONTACTED','INSPECTION','CALCULATION','PROPOSAL','CONTRACT','WON','LOST'));
--> statement-breakpoint
CREATE TABLE lead_activities (id text PRIMARY KEY,lead_id text NOT NULL,type text NOT NULL,status text NOT NULL DEFAULT 'SCHEDULED',scheduled_at integer,completed_at integer,comment text,created_by_user_id text NOT NULL,completed_by_user_id text,created_at integer NOT NULL,updated_at integer NOT NULL,CONSTRAINT lead_activities_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON UPDATE CASCADE ON DELETE RESTRICT,CONSTRAINT lead_activities_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,CONSTRAINT lead_activities_completed_by_user_id_fkey FOREIGN KEY (completed_by_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,CONSTRAINT lead_activities_status_check CHECK (status IN ('SCHEDULED','COMPLETED','CANCELLED')));
--> statement-breakpoint
CREATE INDEX idx_leads_normalized_phone ON leads(normalized_phone);
--> statement-breakpoint
CREATE INDEX idx_leads_stage_created ON leads(stage,created_at DESC);
--> statement-breakpoint
CREATE INDEX idx_leads_responsible_created ON leads(responsible_user_id,created_at DESC);
--> statement-breakpoint
CREATE INDEX idx_leads_linked_client ON leads(linked_client_id);
--> statement-breakpoint
CREATE INDEX idx_leads_source_created ON leads(source,created_at DESC);
--> statement-breakpoint
CREATE INDEX idx_leads_next_action ON leads(next_action_at) WHERE next_action_at IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_lead_activities_lead_created ON lead_activities(lead_id,created_at DESC);
--> statement-breakpoint
CREATE INDEX idx_lead_activities_scheduled_status ON lead_activities(scheduled_at,status);
