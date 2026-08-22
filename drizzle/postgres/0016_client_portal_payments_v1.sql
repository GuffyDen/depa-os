CREATE TABLE client_portal_users (
  id text PRIMARY KEY,
  client_id text NOT NULL,
  login_identifier text NOT NULL,
  login_identifier_normalized text NOT NULL,
  password_hash text NOT NULL,
  password_salt text NOT NULL,
  password_iterations integer NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  last_login_at integer,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CONSTRAINT client_portal_users_client_fkey FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT client_portal_users_status_check CHECK(status IN ('ACTIVE','DISABLED')),
  CONSTRAINT client_portal_users_client_unique UNIQUE(client_id),
  CONSTRAINT client_portal_users_login_unique UNIQUE(login_identifier_normalized)
);
--> statement-breakpoint
CREATE TABLE client_portal_sessions (
  id text PRIMARY KEY,
  portal_user_id text NOT NULL,
  token_hash text NOT NULL,
  created_at integer NOT NULL,
  last_seen_at integer NOT NULL,
  expires_at integer NOT NULL,
  revoked_at integer,
  user_agent text,
  CONSTRAINT client_portal_sessions_user_fkey FOREIGN KEY(portal_user_id) REFERENCES client_portal_users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT client_portal_sessions_token_unique UNIQUE(token_hash)
);
--> statement-breakpoint
CREATE TABLE client_portal_invites (
  id text PRIMARY KEY,
  client_id text NOT NULL,
  token_hash text NOT NULL,
  login_identifier text NOT NULL,
  expires_at integer NOT NULL,
  used_at integer,
  revoked_at integer,
  created_by_user_id text NOT NULL,
  created_at integer NOT NULL,
  CONSTRAINT client_portal_invites_client_fkey FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT client_portal_invites_creator_fkey FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT client_portal_invites_token_unique UNIQUE(token_hash)
);
--> statement-breakpoint
CREATE INDEX idx_client_portal_sessions_user_expires ON client_portal_sessions(portal_user_id,expires_at);
--> statement-breakpoint
CREATE INDEX idx_client_portal_invites_client_created ON client_portal_invites(client_id,created_at);
--> statement-breakpoint
CREATE TABLE client_portal_audit_events (
  id text PRIMARY KEY,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  client_id text,
  client_portal_user_id text,
  employee_user_id text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at integer NOT NULL,
  CONSTRAINT client_portal_audit_client_fkey FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT client_portal_audit_portal_user_fkey FOREIGN KEY(client_portal_user_id) REFERENCES client_portal_users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT client_portal_audit_employee_user_fkey FOREIGN KEY(employee_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
--> statement-breakpoint
CREATE INDEX idx_client_portal_audit_entity_time ON client_portal_audit_events(entity_type,entity_id,occurred_at);
--> statement-breakpoint
CREATE TABLE stage_acceptance_events (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  stage_id text NOT NULL,
  type text NOT NULL,
  client_portal_user_id text,
  employee_user_id text,
  comment text,
  created_at integer NOT NULL,
  CONSTRAINT stage_acceptance_events_project_fkey FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT stage_acceptance_events_stage_fkey FOREIGN KEY(stage_id) REFERENCES project_stages(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT stage_acceptance_events_portal_user_fkey FOREIGN KEY(client_portal_user_id) REFERENCES client_portal_users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT stage_acceptance_events_employee_user_fkey FOREIGN KEY(employee_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT stage_acceptance_events_type_check CHECK(type IN ('AWAITING_ACCEPTANCE','STAGE_ACCEPTED_BY_CLIENT','STAGE_REJECTED_BY_CLIENT','STAGE_RESUBMITTED_FOR_ACCEPTANCE','STAGE_ACCEPTED_MANUALLY_BY_DEPA'))
);
--> statement-breakpoint
CREATE INDEX idx_stage_acceptance_events_stage_time ON stage_acceptance_events(stage_id,created_at);
--> statement-breakpoint
CREATE TABLE project_stage_payment_terms (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  stage_id text NOT NULL,
  stage_amount_kopecks integer NOT NULL,
  required_advance_kopecks integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'RUB',
  position integer NOT NULL,
  payment_plan_version integer NOT NULL DEFAULT 1,
  active integer NOT NULL DEFAULT 1,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CONSTRAINT project_stage_payment_terms_project_fkey FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT project_stage_payment_terms_stage_fkey FOREIGN KEY(stage_id) REFERENCES project_stages(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT project_stage_payment_terms_amount_check CHECK(stage_amount_kopecks>=0 AND required_advance_kopecks>=0),
  CONSTRAINT project_stage_payment_terms_active_check CHECK(active IN (0,1)),
  CONSTRAINT project_stage_payment_terms_stage_version_unique UNIQUE(stage_id,payment_plan_version)
);
--> statement-breakpoint
CREATE INDEX idx_stage_payment_terms_project_position ON project_stage_payment_terms(project_id,payment_plan_version,position);
--> statement-breakpoint
ALTER TABLE projects ADD COLUMN payment_plan_version integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE projects ADD COLUMN payment_plan_activated_at integer;
--> statement-breakpoint
ALTER TABLE projects ADD COLUMN payment_plan_activated_by_user_id text;
--> statement-breakpoint
ALTER TABLE projects ADD CONSTRAINT projects_payment_plan_actor_fkey FOREIGN KEY(payment_plan_activated_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE project_stages ADD COLUMN accepted_by_client_portal_user_id text;
--> statement-breakpoint
ALTER TABLE project_stages ADD CONSTRAINT project_stages_client_acceptor_fkey FOREIGN KEY(accepted_by_client_portal_user_id) REFERENCES client_portal_users(id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE obligations ADD COLUMN obligation_type text;
--> statement-breakpoint
ALTER TABLE obligations ADD COLUMN stage_id text;
--> statement-breakpoint
ALTER TABLE obligations ADD COLUMN payment_plan_version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE obligations ADD COLUMN source_key text;
--> statement-breakpoint
ALTER TABLE obligations ADD COLUMN currency text NOT NULL DEFAULT 'RUB';
--> statement-breakpoint
ALTER TABLE obligations ADD COLUMN cancelled_at integer;
--> statement-breakpoint
ALTER TABLE obligations ADD CONSTRAINT obligations_stage_fkey FOREIGN KEY(stage_id) REFERENCES project_stages(id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE obligations ADD CONSTRAINT obligations_type_check CHECK(obligation_type IS NULL OR obligation_type IN ('STAGE_ADVANCE','STAGE_BALANCE','MANUAL'));
--> statement-breakpoint
ALTER TABLE obligations ADD CONSTRAINT obligations_status_check CHECK(status IN ('OPEN','PARTIALLY_PAID','PAID','CANCELLED'));
--> statement-breakpoint
ALTER TABLE obligations ADD CONSTRAINT obligations_amounts_check CHECK(amount_kopecks>=0 AND paid_kopecks>=0 AND paid_kopecks<=amount_kopecks);
--> statement-breakpoint
CREATE UNIQUE INDEX obligations_source_key_unique ON obligations(source_key) WHERE source_key IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_obligations_stage ON obligations(stage_id);
--> statement-breakpoint
CREATE TABLE client_payment_claims (
  id text PRIMARY KEY,
  client_id text NOT NULL,
  project_id text NOT NULL,
  portal_user_id text NOT NULL,
  claimed_amount_kopecks integer NOT NULL,
  confirmed_amount_kopecks integer,
  payment_method text,
  client_comment text,
  status text NOT NULL DEFAULT 'PENDING',
  claimed_at integer NOT NULL,
  received_at integer,
  confirmed_at integer,
  confirmed_by_user_id text,
  rejected_at integer,
  rejected_by_user_id text,
  rejection_comment text,
  cancelled_at integer,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CONSTRAINT client_payment_claims_client_fkey FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT client_payment_claims_project_fkey FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT client_payment_claims_portal_user_fkey FOREIGN KEY(portal_user_id) REFERENCES client_portal_users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT client_payment_claims_confirmer_fkey FOREIGN KEY(confirmed_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT client_payment_claims_rejecter_fkey FOREIGN KEY(rejected_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT client_payment_claims_amount_check CHECK(claimed_amount_kopecks>0 AND (confirmed_amount_kopecks IS NULL OR confirmed_amount_kopecks>0)),
  CONSTRAINT client_payment_claims_method_check CHECK(payment_method IS NULL OR payment_method IN ('BANK_TRANSFER','CASH','OTHER')),
  CONSTRAINT client_payment_claims_status_check CHECK(status IN ('PENDING','CONFIRMED','REJECTED','CANCELLED'))
);
--> statement-breakpoint
CREATE INDEX idx_client_payment_claims_project_status ON client_payment_claims(project_id,status,created_at);
--> statement-breakpoint
CREATE TABLE client_payment_claim_obligations (
  id text PRIMARY KEY,
  claim_id text NOT NULL,
  obligation_id text NOT NULL,
  intended_amount_kopecks integer NOT NULL,
  position integer NOT NULL,
  created_at integer NOT NULL,
  CONSTRAINT client_payment_claim_obligations_claim_fkey FOREIGN KEY(claim_id) REFERENCES client_payment_claims(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT client_payment_claim_obligations_obligation_fkey FOREIGN KEY(obligation_id) REFERENCES obligations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT client_payment_claim_obligations_amount_check CHECK(intended_amount_kopecks>0),
  CONSTRAINT client_payment_claim_obligations_unique UNIQUE(claim_id,obligation_id)
);
--> statement-breakpoint
CREATE TABLE obligation_payment_allocations (
  id text PRIMARY KEY,
  obligation_id text NOT NULL,
  financial_transaction_id text NOT NULL,
  amount_kopecks integer NOT NULL,
  created_at integer NOT NULL,
  created_by_user_id text NOT NULL,
  CONSTRAINT obligation_allocations_obligation_fkey FOREIGN KEY(obligation_id) REFERENCES obligations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT obligation_allocations_transaction_fkey FOREIGN KEY(financial_transaction_id) REFERENCES financial_transactions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT obligation_allocations_creator_fkey FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT obligation_allocations_amount_check CHECK(amount_kopecks>0),
  CONSTRAINT obligation_allocations_unique UNIQUE(obligation_id,financial_transaction_id)
);
--> statement-breakpoint
CREATE INDEX idx_obligation_allocations_transaction ON obligation_payment_allocations(financial_transaction_id);
--> statement-breakpoint
CREATE TABLE client_unapplied_funds (
  id text PRIMARY KEY,
  client_id text NOT NULL,
  project_id text NOT NULL,
  financial_transaction_id text NOT NULL,
  amount_kopecks integer NOT NULL,
  remaining_kopecks integer NOT NULL,
  created_at integer NOT NULL,
  CONSTRAINT client_unapplied_funds_client_fkey FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT client_unapplied_funds_project_fkey FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT client_unapplied_funds_transaction_fkey FOREIGN KEY(financial_transaction_id) REFERENCES financial_transactions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT client_unapplied_funds_amount_check CHECK(amount_kopecks>0 AND remaining_kopecks>=0 AND remaining_kopecks<=amount_kopecks),
  CONSTRAINT client_unapplied_funds_transaction_unique UNIQUE(financial_transaction_id)
);
--> statement-breakpoint
ALTER TABLE financial_transactions ADD COLUMN client_payment_claim_id text;
--> statement-breakpoint
ALTER TABLE financial_transactions ADD CONSTRAINT financial_transactions_payment_claim_fkey FOREIGN KEY(client_payment_claim_id) REFERENCES client_payment_claims(id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX financial_transactions_payment_claim_unique ON financial_transactions(client_payment_claim_id) WHERE client_payment_claim_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE attachments ADD COLUMN client_payment_claim_id text;
--> statement-breakpoint
ALTER TABLE attachments ADD COLUMN client_visible integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE attachments ADD CONSTRAINT attachments_payment_claim_fkey FOREIGN KEY(client_payment_claim_id) REFERENCES client_payment_claims(id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE attachments ADD CONSTRAINT attachments_client_visible_check CHECK(client_visible IN (0,1));
--> statement-breakpoint
CREATE INDEX idx_attachments_payment_claim ON attachments(client_payment_claim_id);
