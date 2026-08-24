CREATE TABLE project_handovers (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  status text NOT NULL DEFAULT 'NOT_READY',
  current_round_id text,
  prepared_at integer,
  prepared_by_user_id text,
  sent_at integer,
  sent_by_user_id text,
  accepted_at integer,
  accepted_by_client_portal_user_id text,
  manually_accepted_by_user_id text,
  manual_acceptance_reason text,
  actual_handover_at integer,
  warranty_starts_at integer,
  cancelled_at integer,
  cancelled_by_user_id text,
  cancellation_reason text,
  final_snapshot_json jsonb,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CONSTRAINT project_handovers_project_fkey FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT project_handovers_preparer_fkey FOREIGN KEY(prepared_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT project_handovers_sender_fkey FOREIGN KEY(sent_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT project_handovers_client_acceptor_fkey FOREIGN KEY(accepted_by_client_portal_user_id) REFERENCES client_portal_users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT project_handovers_manual_acceptor_fkey FOREIGN KEY(manually_accepted_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT project_handovers_canceller_fkey FOREIGN KEY(cancelled_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT project_handovers_status_check CHECK(status IN ('NOT_READY','READY_FOR_HANDOVER','AWAITING_CLIENT_INSPECTION','CORRECTIONS_REQUIRED','REINSPECTION_REQUIRED','ACCEPTED','CANCELLED')),
  CONSTRAINT project_handovers_acceptance_source_check CHECK(accepted_at IS NULL OR accepted_by_client_portal_user_id IS NOT NULL OR manually_accepted_by_user_id IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX project_handovers_project_unique ON project_handovers(project_id);
--> statement-breakpoint
CREATE INDEX idx_project_handovers_status_updated ON project_handovers(status,updated_at DESC);
--> statement-breakpoint
CREATE TABLE project_handover_rounds (
  id text PRIMARY KEY,
  handover_id text NOT NULL,
  project_id text NOT NULL,
  round_number integer NOT NULL,
  status text NOT NULL DEFAULT 'OPEN',
  opened_at integer NOT NULL,
  opened_by_user_id text,
  opened_by_client_portal_user_id text,
  submitted_at integer,
  submitted_by_client_portal_user_id text,
  accepted_at integer,
  accepted_by_client_portal_user_id text,
  superseded_at integer,
  client_comment text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CONSTRAINT project_handover_rounds_handover_fkey FOREIGN KEY(handover_id) REFERENCES project_handovers(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT project_handover_rounds_project_fkey FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT project_handover_rounds_opener_fkey FOREIGN KEY(opened_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT project_handover_rounds_portal_opener_fkey FOREIGN KEY(opened_by_client_portal_user_id) REFERENCES client_portal_users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT project_handover_rounds_submitter_fkey FOREIGN KEY(submitted_by_client_portal_user_id) REFERENCES client_portal_users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT project_handover_rounds_acceptor_fkey FOREIGN KEY(accepted_by_client_portal_user_id) REFERENCES client_portal_users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT project_handover_rounds_status_check CHECK(status IN ('OPEN','SUBMITTED_WITH_DEFECTS','ACCEPTED','SUPERSEDED')),
  CONSTRAINT project_handover_rounds_number_check CHECK(round_number > 0),
  CONSTRAINT project_handover_rounds_opener_check CHECK(opened_by_user_id IS NOT NULL OR opened_by_client_portal_user_id IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX project_handover_rounds_number_unique ON project_handover_rounds(handover_id,round_number);
--> statement-breakpoint
CREATE UNIQUE INDEX project_handover_rounds_open_unique ON project_handover_rounds(handover_id) WHERE status='OPEN';
--> statement-breakpoint
CREATE INDEX idx_project_handover_rounds_project_time ON project_handover_rounds(project_id,created_at DESC);
--> statement-breakpoint
ALTER TABLE project_handovers ADD CONSTRAINT project_handovers_current_round_fkey FOREIGN KEY(current_round_id) REFERENCES project_handover_rounds(id) ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE TABLE project_handover_defects (
  id text PRIMARY KEY,
  handover_id text NOT NULL,
  round_id text NOT NULL,
  project_id text NOT NULL,
  defect_number integer NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  location text,
  priority text NOT NULL DEFAULT 'NORMAL',
  status text NOT NULL DEFAULT 'OPEN',
  created_by_client_portal_user_id text,
  created_by_user_id text,
  assigned_to_user_id text,
  internal_comment text,
  resolution_comment text,
  resolved_at integer,
  resolved_by_user_id text,
  accepted_at integer,
  accepted_by_client_portal_user_id text,
  disputed_at integer,
  dispute_comment text,
  cancelled_at integer,
  cancelled_by_user_id text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CONSTRAINT project_handover_defects_handover_fkey FOREIGN KEY(handover_id) REFERENCES project_handovers(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT project_handover_defects_round_fkey FOREIGN KEY(round_id) REFERENCES project_handover_rounds(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT project_handover_defects_project_fkey FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT project_handover_defects_client_creator_fkey FOREIGN KEY(created_by_client_portal_user_id) REFERENCES client_portal_users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT project_handover_defects_employee_creator_fkey FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT project_handover_defects_assignee_fkey FOREIGN KEY(assigned_to_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT project_handover_defects_resolver_fkey FOREIGN KEY(resolved_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT project_handover_defects_client_acceptor_fkey FOREIGN KEY(accepted_by_client_portal_user_id) REFERENCES client_portal_users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT project_handover_defects_canceller_fkey FOREIGN KEY(cancelled_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT project_handover_defects_status_check CHECK(status IN ('OPEN','IN_PROGRESS','RESOLVED','ACCEPTED','DISPUTED','CANCELLED')),
  CONSTRAINT project_handover_defects_priority_check CHECK(priority IN ('NORMAL','IMPORTANT')),
  CONSTRAINT project_handover_defects_number_check CHECK(defect_number > 0),
  CONSTRAINT project_handover_defects_creator_check CHECK(created_by_client_portal_user_id IS NOT NULL OR created_by_user_id IS NOT NULL),
  CONSTRAINT project_handover_defects_resolution_check CHECK(status<>'RESOLVED' OR (resolution_comment IS NOT NULL AND length(trim(resolution_comment))>0 AND resolved_at IS NOT NULL AND resolved_by_user_id IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX project_handover_defects_number_unique ON project_handover_defects(project_id,defect_number);
--> statement-breakpoint
CREATE INDEX idx_project_handover_defects_handover_status ON project_handover_defects(handover_id,status,created_at DESC);
--> statement-breakpoint
CREATE INDEX idx_project_handover_defects_round ON project_handover_defects(round_id,created_at);
--> statement-breakpoint
CREATE INDEX idx_project_handover_defects_assignee ON project_handover_defects(assigned_to_user_id,status);
--> statement-breakpoint
CREATE TABLE project_handover_events (
  id text PRIMARY KEY,
  handover_id text NOT NULL,
  project_id text NOT NULL,
  round_id text,
  type text NOT NULL,
  employee_user_id text,
  client_portal_user_id text,
  comment text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at integer NOT NULL,
  CONSTRAINT project_handover_events_handover_fkey FOREIGN KEY(handover_id) REFERENCES project_handovers(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT project_handover_events_project_fkey FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT project_handover_events_round_fkey FOREIGN KEY(round_id) REFERENCES project_handover_rounds(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT project_handover_events_employee_fkey FOREIGN KEY(employee_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT project_handover_events_portal_fkey FOREIGN KEY(client_portal_user_id) REFERENCES client_portal_users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT project_handover_events_actor_check CHECK(employee_user_id IS NOT NULL OR client_portal_user_id IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX idx_project_handover_events_handover_time ON project_handover_events(handover_id,occurred_at DESC);
--> statement-breakpoint
CREATE TABLE project_handover_defect_events (
  id text PRIMARY KEY,
  defect_id text NOT NULL,
  handover_id text NOT NULL,
  project_id text NOT NULL,
  type text NOT NULL,
  employee_user_id text,
  client_portal_user_id text,
  comment text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at integer NOT NULL,
  CONSTRAINT project_handover_defect_events_defect_fkey FOREIGN KEY(defect_id) REFERENCES project_handover_defects(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT project_handover_defect_events_handover_fkey FOREIGN KEY(handover_id) REFERENCES project_handovers(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT project_handover_defect_events_project_fkey FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT project_handover_defect_events_employee_fkey FOREIGN KEY(employee_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT project_handover_defect_events_portal_fkey FOREIGN KEY(client_portal_user_id) REFERENCES client_portal_users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT project_handover_defect_events_actor_check CHECK(employee_user_id IS NOT NULL OR client_portal_user_id IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX idx_project_handover_defect_events_defect_time ON project_handover_defect_events(defect_id,occurred_at DESC);
--> statement-breakpoint
CREATE TABLE handover_checklist_templates (
  id text PRIMARY KEY,
  name text NOT NULL,
  version integer NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_by_user_id text NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CONSTRAINT handover_checklist_templates_creator_fkey FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT handover_checklist_templates_status_check CHECK(status IN ('ACTIVE','ARCHIVED')),
  CONSTRAINT handover_checklist_templates_version_check CHECK(version > 0)
);
--> statement-breakpoint
CREATE TABLE handover_checklist_template_items (
  id text PRIMARY KEY,
  template_id text NOT NULL,
  position integer NOT NULL,
  title text NOT NULL,
  required integer NOT NULL DEFAULT 1,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CONSTRAINT handover_checklist_template_items_template_fkey FOREIGN KEY(template_id) REFERENCES handover_checklist_templates(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT handover_checklist_template_items_position_unique UNIQUE(template_id,position),
  CONSTRAINT handover_checklist_template_items_required_check CHECK(required IN (0,1))
);
--> statement-breakpoint
CREATE TABLE project_handover_round_checklist_items (
  id text PRIMARY KEY,
  round_id text NOT NULL,
  template_item_id text,
  position integer NOT NULL,
  title text NOT NULL,
  required integer NOT NULL DEFAULT 1,
  checked integer NOT NULL DEFAULT 0,
  comment text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CONSTRAINT project_handover_round_checklist_round_fkey FOREIGN KEY(round_id) REFERENCES project_handover_rounds(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT project_handover_round_checklist_template_item_fkey FOREIGN KEY(template_item_id) REFERENCES handover_checklist_template_items(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT project_handover_round_checklist_position_unique UNIQUE(round_id,position),
  CONSTRAINT project_handover_round_checklist_flags_check CHECK(required IN (0,1) AND checked IN (0,1))
);
--> statement-breakpoint
CREATE TABLE handover_defect_task_links (
  id text PRIMARY KEY,
  defect_id text NOT NULL,
  task_id text NOT NULL,
  created_by_user_id text NOT NULL,
  created_at integer NOT NULL,
  CONSTRAINT handover_defect_task_links_defect_fkey FOREIGN KEY(defect_id) REFERENCES project_handover_defects(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT handover_defect_task_links_task_fkey FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT handover_defect_task_links_creator_fkey FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT handover_defect_task_links_defect_task_unique UNIQUE(defect_id,task_id)
);
--> statement-breakpoint
CREATE INDEX idx_handover_defect_task_links_task ON handover_defect_task_links(task_id);
--> statement-breakpoint
ALTER TABLE attachments ADD COLUMN handover_id text;
--> statement-breakpoint
ALTER TABLE attachments ADD COLUMN handover_round_id text;
--> statement-breakpoint
ALTER TABLE attachments ADD COLUMN handover_defect_id text;
--> statement-breakpoint
ALTER TABLE attachments ADD CONSTRAINT attachments_handover_fkey FOREIGN KEY(handover_id) REFERENCES project_handovers(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE attachments ADD CONSTRAINT attachments_handover_round_fkey FOREIGN KEY(handover_round_id) REFERENCES project_handover_rounds(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE attachments ADD CONSTRAINT attachments_handover_defect_fkey FOREIGN KEY(handover_defect_id) REFERENCES project_handover_defects(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
CREATE INDEX idx_attachments_handover ON attachments(handover_id,created_at DESC);
--> statement-breakpoint
CREATE INDEX idx_attachments_handover_defect ON attachments(handover_defect_id,created_at DESC);
--> statement-breakpoint
ALTER TABLE attachments DROP CONSTRAINT attachments_category_check;
--> statement-breakpoint
ALTER TABLE attachments ADD CONSTRAINT attachments_category_check CHECK(category IN ('RECEIPT','PROJECT_PHOTO','DAILY_REPORT','HIDDEN_WORK','CONTRACT','ACT','ESTIMATE','INSPECTION','WARRANTY','MEASUREMENT_PLAN','LAYOUT','CONCEPT','VISUALIZATION','WORKING_DRAWINGS','SPECIFICATION','FINAL_ALBUM','CONTRACT_DOCX','CONTRACT_PDF','SIGNED_CONTRACT','CONTRACT_OTHER','ADDITIONAL_WORK','HANDOVER_PHOTO','HANDOVER_DEFECT','HANDOVER_DEFECT_RESOLUTION','HANDOVER_DOCUMENT','OTHER'));
