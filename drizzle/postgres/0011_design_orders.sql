ALTER TABLE orders DROP CONSTRAINT orders_type_check;
--> statement-breakpoint
ALTER TABLE orders ADD CONSTRAINT orders_type_check CHECK(type IN ('INSPECTION','DESIGN','RENOVATION'));
--> statement-breakpoint
ALTER TABLE orders ADD COLUMN source_lead_id text;
--> statement-breakpoint
ALTER TABLE orders ADD COLUMN source_order_id text;
--> statement-breakpoint
ALTER TABLE orders ADD CONSTRAINT orders_source_lead_id_fkey FOREIGN KEY(source_lead_id) REFERENCES leads(id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE orders ADD CONSTRAINT orders_source_order_id_fkey FOREIGN KEY(source_order_id) REFERENCES orders(id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
CREATE INDEX idx_orders_type ON orders(type);
--> statement-breakpoint
CREATE INDEX idx_orders_source_lead ON orders(source_lead_id);
--> statement-breakpoint
CREATE INDEX idx_orders_source_order ON orders(source_order_id);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_projects_order_unique ON projects(order_id) WHERE order_id IS NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_order_service_link() RETURNS trigger AS $$
DECLARE expected_type text;
BEGIN
  IF TG_TABLE_NAME='design_projects' THEN expected_type := 'DESIGN';
  ELSIF TG_TABLE_NAME='renovation_order_details' OR TG_TABLE_NAME='projects' THEN expected_type := 'RENOVATION';
  ELSE RAISE EXCEPTION 'Unsupported order service link table: %',TG_TABLE_NAME;
  END IF;
  IF NEW.order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM orders WHERE id=NEW.order_id AND type=expected_type) THEN
    RAISE EXCEPTION '% can only reference a % order',TG_TABLE_NAME,expected_type;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TABLE design_projects(
  id text PRIMARY KEY,
  order_id text NOT NULL,
  residential_complex text,
  residential_complex_id text,
  address text NOT NULL,
  apartment_number text NOT NULL,
  area_sqm numeric(10,2),
  designer_employee_id text,
  planned_start_date integer,
  planned_end_date integer,
  actual_end_date integer,
  status text NOT NULL DEFAULT 'PLANNING',
  comment text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CONSTRAINT design_projects_order_unique UNIQUE(order_id),
  CONSTRAINT design_projects_order_id_fkey FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT design_projects_designer_employee_id_fkey FOREIGN KEY(designer_employee_id) REFERENCES employees(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT design_projects_area_check CHECK(area_sqm IS NULL OR area_sqm>0),
  CONSTRAINT design_projects_status_check CHECK(status IN ('PLANNING','IN_PROGRESS','WAITING_CLIENT','COMPLETED','PAUSED','CANCELLED'))
);
--> statement-breakpoint
CREATE INDEX idx_design_projects_designer ON design_projects(designer_employee_id);
--> statement-breakpoint
CREATE INDEX idx_design_projects_status ON design_projects(status);
--> statement-breakpoint
CREATE INDEX idx_design_projects_planned_end ON design_projects(planned_end_date);
--> statement-breakpoint
CREATE TRIGGER design_projects_order_type_guard BEFORE INSERT OR UPDATE OF order_id ON design_projects FOR EACH ROW EXECUTE FUNCTION enforce_order_service_link();
--> statement-breakpoint
CREATE TABLE design_project_stages(
  id text PRIMARY KEY,
  design_project_id text NOT NULL,
  name text NOT NULL,
  position integer NOT NULL,
  status text NOT NULL DEFAULT 'NOT_STARTED',
  planned_start_date integer,
  planned_end_date integer,
  completed_at integer,
  responsible_user_id text,
  comment text,
  archived_at integer,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CONSTRAINT design_project_stages_project_id_fkey FOREIGN KEY(design_project_id) REFERENCES design_projects(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT design_project_stages_responsible_user_id_fkey FOREIGN KEY(responsible_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT design_project_stages_position_check CHECK(position>=0),
  CONSTRAINT design_project_stages_status_check CHECK(status IN ('NOT_STARTED','IN_PROGRESS','WAITING_CLIENT','COMPLETED'))
);
--> statement-breakpoint
CREATE INDEX idx_design_stages_project_position ON design_project_stages(design_project_id,position);
--> statement-breakpoint
CREATE INDEX idx_design_stages_status ON design_project_stages(status);
--> statement-breakpoint
CREATE TABLE design_project_events(
  id text PRIMARY KEY,
  design_project_id text NOT NULL,
  order_id text NOT NULL,
  actor_user_id text NOT NULL,
  type text NOT NULL,
  occurred_at integer NOT NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT design_project_events_project_id_fkey FOREIGN KEY(design_project_id) REFERENCES design_projects(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT design_project_events_order_id_fkey FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT design_project_events_actor_user_id_fkey FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
--> statement-breakpoint
CREATE INDEX idx_design_events_project_time ON design_project_events(design_project_id,occurred_at DESC);
--> statement-breakpoint
CREATE TABLE renovation_order_details(
  id text PRIMARY KEY,
  order_id text NOT NULL,
  residential_complex text,
  residential_complex_id text,
  address text NOT NULL,
  apartment_number text NOT NULL,
  area_sqm numeric(10,2),
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CONSTRAINT renovation_order_details_order_unique UNIQUE(order_id),
  CONSTRAINT renovation_order_details_order_id_fkey FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT renovation_order_details_area_check CHECK(area_sqm IS NULL OR area_sqm>0)
);
--> statement-breakpoint
CREATE TRIGGER renovation_order_details_type_guard BEFORE INSERT OR UPDATE OF order_id ON renovation_order_details FOR EACH ROW EXECUTE FUNCTION enforce_order_service_link();
--> statement-breakpoint
CREATE TRIGGER projects_order_type_guard BEFORE INSERT OR UPDATE OF order_id ON projects FOR EACH ROW EXECUTE FUNCTION enforce_order_service_link();
--> statement-breakpoint
ALTER TABLE attachments DROP CONSTRAINT attachments_category_check;
--> statement-breakpoint
ALTER TABLE attachments ADD CONSTRAINT attachments_category_check CHECK(category IN ('RECEIPT','PROJECT_PHOTO','DAILY_REPORT','HIDDEN_WORK','CONTRACT','ACT','ESTIMATE','INSPECTION','WARRANTY','MEASUREMENT_PLAN','LAYOUT','CONCEPT','VISUALIZATION','WORKING_DRAWINGS','SPECIFICATION','FINAL_ALBUM','OTHER'));
--> statement-breakpoint
ALTER TABLE attachments ADD COLUMN design_project_id text;
--> statement-breakpoint
ALTER TABLE attachments ADD COLUMN design_stage_id text;
--> statement-breakpoint
ALTER TABLE attachments ADD COLUMN previous_version_id text;
--> statement-breakpoint
ALTER TABLE attachments ADD COLUMN logical_name text;
--> statement-breakpoint
ALTER TABLE attachments ADD COLUMN version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE attachments ADD COLUMN is_current integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE attachments ADD COLUMN archived_at integer;
--> statement-breakpoint
ALTER TABLE attachments ADD CONSTRAINT attachments_design_project_id_fkey FOREIGN KEY(design_project_id) REFERENCES design_projects(id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE attachments ADD CONSTRAINT attachments_design_stage_id_fkey FOREIGN KEY(design_stage_id) REFERENCES design_project_stages(id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE attachments ADD CONSTRAINT attachments_previous_version_id_fkey FOREIGN KEY(previous_version_id) REFERENCES attachments(id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE attachments ADD CONSTRAINT attachments_version_check CHECK(version>0);
--> statement-breakpoint
ALTER TABLE attachments ADD CONSTRAINT attachments_is_current_check CHECK(is_current IN (0,1));
--> statement-breakpoint
CREATE INDEX idx_attachments_design_project ON attachments(design_project_id,category,logical_name,version DESC);
--> statement-breakpoint
CREATE INDEX idx_attachments_design_stage ON attachments(design_stage_id);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_attachments_design_version_unique ON attachments(design_project_id,category,logical_name,version) WHERE design_project_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_attachments_design_current_unique ON attachments(design_project_id,category,logical_name) WHERE design_project_id IS NOT NULL AND is_current=1 AND archived_at IS NULL AND deleted_at IS NULL;
