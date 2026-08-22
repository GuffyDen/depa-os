CREATE TABLE estimates (
  id text PRIMARY KEY,
  client_id text NOT NULL,
  responsible_user_id text NOT NULL,
  residential_complex_id text,
  address text NOT NULL,
  apartment_number text,
  area_sqm numeric(10,2),
  source_lead_id text,
  source_order_id text,
  project_id text,
  status text NOT NULL DEFAULT 'ACTIVE',
  current_version_id text,
  approved_version_id text,
  created_by_user_id text NOT NULL,
  archived_at integer,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CONSTRAINT estimates_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT estimates_responsible_user_id_fkey FOREIGN KEY (responsible_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT estimates_residential_complex_id_fkey FOREIGN KEY (residential_complex_id) REFERENCES residential_complexes(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT estimates_source_lead_id_fkey FOREIGN KEY (source_lead_id) REFERENCES leads(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT estimates_source_order_id_fkey FOREIGN KEY (source_order_id) REFERENCES orders(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT estimates_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT estimates_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT estimates_status_check CHECK (status IN ('ACTIVE','CLOSED')),
  CONSTRAINT estimates_area_check CHECK (area_sqm IS NULL OR area_sqm > 0)
);
--> statement-breakpoint
ALTER TABLE estimate_versions ALTER COLUMN project_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE estimate_versions ADD COLUMN estimate_id text;
--> statement-breakpoint
ALTER TABLE estimate_versions ADD COLUMN status text NOT NULL DEFAULT 'DRAFT';
--> statement-breakpoint
ALTER TABLE estimate_versions ADD COLUMN estimated_materials_budget_kopecks integer;
--> statement-breakpoint
ALTER TABLE estimate_versions ADD COLUMN planned_duration text;
--> statement-breakpoint
ALTER TABLE estimate_versions ADD COLUMN client_comment text;
--> statement-breakpoint
ALTER TABLE estimate_versions ADD COLUMN internal_comment text;
--> statement-breakpoint
ALTER TABLE estimate_versions ADD COLUMN sent_at integer;
--> statement-breakpoint
ALTER TABLE estimate_versions ADD COLUMN sent_by_user_id text;
--> statement-breakpoint
ALTER TABLE estimate_versions ADD COLUMN approved_at integer;
--> statement-breakpoint
ALTER TABLE estimate_versions ADD COLUMN approved_by_user_id text;
--> statement-breakpoint
ALTER TABLE estimate_versions ADD COLUMN approval_comment text;
--> statement-breakpoint
ALTER TABLE estimate_versions ADD COLUMN rejected_at integer;
--> statement-breakpoint
ALTER TABLE estimate_versions ADD COLUMN rejected_by_user_id text;
--> statement-breakpoint
ALTER TABLE estimate_versions ADD COLUMN rejection_reason text;
--> statement-breakpoint
ALTER TABLE estimate_versions ADD CONSTRAINT estimate_versions_estimate_id_fkey FOREIGN KEY (estimate_id) REFERENCES estimates(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE estimate_versions ADD CONSTRAINT estimate_versions_sent_by_user_id_fkey FOREIGN KEY (sent_by_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE estimate_versions ADD CONSTRAINT estimate_versions_approved_by_user_id_fkey FOREIGN KEY (approved_by_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE estimate_versions ADD CONSTRAINT estimate_versions_rejected_by_user_id_fkey FOREIGN KEY (rejected_by_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE estimate_versions ADD CONSTRAINT estimate_versions_parent_check CHECK (estimate_id IS NOT NULL OR project_id IS NOT NULL);
--> statement-breakpoint
ALTER TABLE estimate_versions ADD CONSTRAINT estimate_versions_status_check CHECK (status IN ('DRAFT','SENT','APPROVED','REJECTED','SUPERSEDED'));
--> statement-breakpoint
ALTER TABLE estimate_versions ADD CONSTRAINT estimate_versions_total_check CHECK (total_kopecks >= 0);
--> statement-breakpoint
ALTER TABLE estimate_versions ADD CONSTRAINT estimate_versions_materials_check CHECK (estimated_materials_budget_kopecks IS NULL OR estimated_materials_budget_kopecks >= 0);
--> statement-breakpoint
ALTER TABLE estimates ADD CONSTRAINT estimates_current_version_id_fkey FOREIGN KEY (current_version_id) REFERENCES estimate_versions(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE estimates ADD CONSTRAINT estimates_approved_version_id_fkey FOREIGN KEY (approved_version_id) REFERENCES estimate_versions(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--> statement-breakpoint
CREATE TABLE estimate_sections (
  id text PRIMARY KEY,
  version_id text NOT NULL,
  name text NOT NULL,
  position integer NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CONSTRAINT estimate_sections_version_id_fkey FOREIGN KEY (version_id) REFERENCES estimate_versions(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT estimate_sections_position_check CHECK (position >= 0)
);
--> statement-breakpoint
CREATE TABLE estimate_items (
  id text PRIMARY KEY,
  section_id text NOT NULL,
  name text NOT NULL,
  unit text NOT NULL,
  quantity numeric(14,2) NOT NULL,
  client_price_kopecks integer NOT NULL,
  internal_cost_kopecks integer,
  position integer NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CONSTRAINT estimate_items_section_id_fkey FOREIGN KEY (section_id) REFERENCES estimate_sections(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT estimate_items_quantity_check CHECK (quantity > 0),
  CONSTRAINT estimate_items_client_price_check CHECK (client_price_kopecks >= 0),
  CONSTRAINT estimate_items_internal_cost_check CHECK (internal_cost_kopecks IS NULL OR internal_cost_kopecks >= 0),
  CONSTRAINT estimate_items_position_check CHECK (position >= 0)
);
--> statement-breakpoint
CREATE TABLE estimate_events (
  id text PRIMARY KEY,
  estimate_id text NOT NULL,
  version_id text,
  actor_user_id text NOT NULL,
  type text NOT NULL,
  occurred_at integer NOT NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT estimate_events_estimate_id_fkey FOREIGN KEY (estimate_id) REFERENCES estimates(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT estimate_events_version_id_fkey FOREIGN KEY (version_id) REFERENCES estimate_versions(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT estimate_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT
);
--> statement-breakpoint
ALTER TABLE renovation_order_details ADD COLUMN approved_estimate_version_id text;
--> statement-breakpoint
ALTER TABLE renovation_order_details ADD CONSTRAINT renovation_order_details_approved_estimate_version_id_fkey FOREIGN KEY (approved_estimate_version_id) REFERENCES estimate_versions(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE projects ADD COLUMN approved_estimate_version_id text;
--> statement-breakpoint
ALTER TABLE projects ADD CONSTRAINT projects_approved_estimate_version_id_fkey FOREIGN KEY (approved_estimate_version_id) REFERENCES estimate_versions(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX idx_estimates_client ON estimates(client_id);
--> statement-breakpoint
CREATE INDEX idx_estimates_responsible ON estimates(responsible_user_id);
--> statement-breakpoint
CREATE INDEX idx_estimates_residential_complex ON estimates(residential_complex_id);
--> statement-breakpoint
CREATE INDEX idx_estimates_source_lead ON estimates(source_lead_id);
--> statement-breakpoint
CREATE INDEX idx_estimates_source_order ON estimates(source_order_id);
--> statement-breakpoint
CREATE INDEX idx_estimates_project ON estimates(project_id);
--> statement-breakpoint
CREATE INDEX idx_estimates_created ON estimates(created_at DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_estimate_version_number ON estimate_versions(estimate_id,version) WHERE estimate_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_estimate_version_estimate_status ON estimate_versions(estimate_id,status);
--> statement-breakpoint
CREATE INDEX idx_estimate_sections_version_position ON estimate_sections(version_id,position);
--> statement-breakpoint
CREATE INDEX idx_estimate_items_section_position ON estimate_items(section_id,position);
--> statement-breakpoint
CREATE INDEX idx_estimate_events_estimate_time ON estimate_events(estimate_id,occurred_at DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_renovation_estimate_version_unique ON renovation_order_details(approved_estimate_version_id) WHERE approved_estimate_version_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_projects_approved_estimate_version ON projects(approved_estimate_version_id);
