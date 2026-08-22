CREATE SEQUENCE depa_contract_number_seq START 1;
--> statement-breakpoint
CREATE TABLE company_settings (
  id text PRIMARY KEY,
  legal_name text,
  trade_name text,
  inn text,
  kpp text,
  ogrn text,
  legal_address text,
  postal_address text,
  bank_name text,
  bank_account text,
  correspondent_account text,
  bik text,
  director_name text,
  director_title text,
  acting_basis text,
  phone text,
  email text,
  updated_by_user_id text NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CONSTRAINT company_settings_updated_by_fkey FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE contract_templates (
  id text PRIMARY KEY,
  name text NOT NULL,
  contract_type text NOT NULL DEFAULT 'RENOVATION',
  status text NOT NULL DEFAULT 'DRAFT',
  current_version_id text,
  created_by_user_id text NOT NULL,
  archived_at integer,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CONSTRAINT contract_templates_created_by_fkey FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT contract_templates_type_check CHECK (contract_type IN ('RENOVATION','DESIGN','OTHER')),
  CONSTRAINT contract_templates_status_check CHECK (status IN ('DRAFT','ACTIVE','ARCHIVED'))
);
--> statement-breakpoint
CREATE TABLE contract_template_versions (
  id text PRIMARY KEY,
  template_id text NOT NULL,
  version integer NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  body_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  change_reason text,
  created_by_user_id text NOT NULL,
  published_at integer,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CONSTRAINT contract_template_versions_template_fkey FOREIGN KEY (template_id) REFERENCES contract_templates(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT contract_template_versions_created_by_fkey FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT contract_template_versions_version_check CHECK (version > 0),
  CONSTRAINT contract_template_versions_status_check CHECK (status IN ('DRAFT','ACTIVE','SUPERSEDED')),
  CONSTRAINT contract_template_versions_number_unique UNIQUE (template_id,version)
);
--> statement-breakpoint
ALTER TABLE contract_templates ADD CONSTRAINT contract_templates_current_version_fkey FOREIGN KEY (current_version_id) REFERENCES contract_template_versions(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--> statement-breakpoint
CREATE TABLE contracts (
  id text PRIMARY KEY,
  contract_number text NOT NULL,
  client_id text NOT NULL,
  order_id text NOT NULL,
  project_id text,
  type text NOT NULL DEFAULT 'RENOVATION',
  status text NOT NULL DEFAULT 'DRAFT',
  responsible_user_id text NOT NULL,
  current_version_id text,
  signed_version_id text,
  created_by_user_id text NOT NULL,
  cancelled_at integer,
  cancelled_by_user_id text,
  cancellation_reason text,
  archived_at integer,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CONSTRAINT contracts_number_unique UNIQUE (contract_number),
  CONSTRAINT contracts_order_unique UNIQUE (order_id),
  CONSTRAINT contracts_client_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT contracts_order_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT contracts_project_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT contracts_responsible_fkey FOREIGN KEY (responsible_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT contracts_created_by_fkey FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT contracts_cancelled_by_fkey FOREIGN KEY (cancelled_by_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT contracts_type_check CHECK (type IN ('RENOVATION','DESIGN','OTHER')),
  CONSTRAINT contracts_status_check CHECK (status IN ('DRAFT','READY','SENT','SIGNED','CANCELLED','SUPERSEDED')),
  CONSTRAINT contracts_cancel_check CHECK ((status='CANCELLED' AND cancelled_at IS NOT NULL AND cancelled_by_user_id IS NOT NULL AND cancellation_reason IS NOT NULL) OR status<>'CANCELLED')
);
--> statement-breakpoint
CREATE TABLE contract_versions (
  id text PRIMARY KEY,
  contract_id text NOT NULL,
  version integer NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  contract_date integer,
  estimate_version_id text,
  template_version_id text,
  template_version_number integer,
  contract_amount_kopecks integer NOT NULL,
  estimated_materials_budget_kopecks integer,
  planned_start_date integer,
  planned_end_date integer,
  planned_duration text,
  payment_terms_text text,
  warranty_term text,
  client_snapshot_json jsonb NOT NULL,
  company_snapshot_json jsonb NOT NULL,
  property_snapshot_json jsonb NOT NULL,
  terms_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  document_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  change_reason text,
  sent_at integer,
  sent_by_user_id text,
  signed_at integer,
  signed_by_user_id text,
  signature_note text,
  created_by_user_id text NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CONSTRAINT contract_versions_contract_fkey FOREIGN KEY (contract_id) REFERENCES contracts(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT contract_versions_estimate_fkey FOREIGN KEY (estimate_version_id) REFERENCES estimate_versions(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT contract_versions_template_fkey FOREIGN KEY (template_version_id) REFERENCES contract_template_versions(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT contract_versions_sent_by_fkey FOREIGN KEY (sent_by_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT contract_versions_signed_by_fkey FOREIGN KEY (signed_by_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT contract_versions_created_by_fkey FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT contract_versions_number_unique UNIQUE (contract_id,version),
  CONSTRAINT contract_versions_version_check CHECK (version > 0),
  CONSTRAINT contract_versions_status_check CHECK (status IN ('DRAFT','READY','SENT','SIGNED','SUPERSEDED')),
  CONSTRAINT contract_versions_amount_check CHECK (contract_amount_kopecks >= 0),
  CONSTRAINT contract_versions_materials_check CHECK (estimated_materials_budget_kopecks IS NULL OR estimated_materials_budget_kopecks >= 0),
  CONSTRAINT contract_versions_signed_check CHECK ((status='SIGNED' AND signed_at IS NOT NULL AND signed_by_user_id IS NOT NULL) OR status<>'SIGNED')
);
--> statement-breakpoint
ALTER TABLE contracts ADD CONSTRAINT contracts_current_version_fkey FOREIGN KEY (current_version_id) REFERENCES contract_versions(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE contracts ADD CONSTRAINT contracts_signed_version_fkey FOREIGN KEY (signed_version_id) REFERENCES contract_versions(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--> statement-breakpoint
CREATE TABLE contract_events (
  id text PRIMARY KEY,
  contract_id text NOT NULL,
  version_id text,
  actor_user_id text NOT NULL,
  type text NOT NULL,
  occurred_at integer NOT NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT contract_events_contract_fkey FOREIGN KEY (contract_id) REFERENCES contracts(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT contract_events_version_fkey FOREIGN KEY (version_id) REFERENCES contract_versions(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT contract_events_actor_fkey FOREIGN KEY (actor_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT
);
--> statement-breakpoint
ALTER TABLE projects ADD COLUMN contract_id text;
--> statement-breakpoint
ALTER TABLE projects ADD CONSTRAINT projects_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES contracts(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE attachments ADD COLUMN contract_version_id text;
--> statement-breakpoint
ALTER TABLE attachments ADD CONSTRAINT attachments_contract_version_fkey FOREIGN KEY (contract_version_id) REFERENCES contract_versions(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE attachments DROP CONSTRAINT attachments_category_check;
--> statement-breakpoint
ALTER TABLE attachments ADD CONSTRAINT attachments_category_check CHECK (category IN ('RECEIPT','PROJECT_PHOTO','DAILY_REPORT','HIDDEN_WORK','CONTRACT','ACT','ESTIMATE','INSPECTION','WARRANTY','MEASUREMENT_PLAN','LAYOUT','CONCEPT','VISUALIZATION','WORKING_DRAWINGS','SPECIFICATION','FINAL_ALBUM','CONTRACT_DOCX','CONTRACT_PDF','SIGNED_CONTRACT','CONTRACT_OTHER','OTHER'));
--> statement-breakpoint
CREATE INDEX idx_contracts_client ON contracts(client_id);
--> statement-breakpoint
CREATE INDEX idx_contracts_responsible_status_created ON contracts(responsible_user_id,status,created_at DESC);
--> statement-breakpoint
CREATE INDEX idx_contracts_project ON contracts(project_id);
--> statement-breakpoint
CREATE INDEX idx_contract_versions_contract_created ON contract_versions(contract_id,version DESC);
--> statement-breakpoint
CREATE INDEX idx_contract_versions_estimate ON contract_versions(estimate_version_id);
--> statement-breakpoint
CREATE INDEX idx_contract_events_contract_time ON contract_events(contract_id,occurred_at DESC);
--> statement-breakpoint
CREATE INDEX idx_contract_template_versions_template ON contract_template_versions(template_id,version DESC);
--> statement-breakpoint
CREATE INDEX idx_projects_contract ON projects(contract_id);
--> statement-breakpoint
CREATE INDEX idx_attachments_contract_version ON attachments(contract_version_id,created_at DESC);
