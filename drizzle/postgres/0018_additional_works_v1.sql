CREATE SEQUENCE additional_work_number_seq START WITH 1 INCREMENT BY 1 NO CYCLE;
--> statement-breakpoint
CREATE TABLE additional_works (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  client_id text NOT NULL,
  order_id text,
  contract_id text,
  stage_id text,
  number text NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  responsible_user_id text NOT NULL,
  current_version_id text,
  approved_version_id text,
  created_by_user_id text NOT NULL,
  approved_by_client_portal_user_id text,
  cancelled_at integer,
  cancellation_reason text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CONSTRAINT additional_works_project_fkey FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT additional_works_client_fkey FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT additional_works_order_fkey FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT additional_works_contract_fkey FOREIGN KEY(contract_id) REFERENCES contracts(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT additional_works_stage_fkey FOREIGN KEY(stage_id) REFERENCES project_stages(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT additional_works_responsible_fkey FOREIGN KEY(responsible_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT additional_works_creator_fkey FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT additional_works_portal_approver_fkey FOREIGN KEY(approved_by_client_portal_user_id) REFERENCES client_portal_users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT additional_works_status_check CHECK(status IN ('DRAFT','READY','SENT','AWAITING_CLIENT_APPROVAL','APPROVED','REJECTED','CANCELLED','SUPERSEDED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX additional_works_number_unique ON additional_works(number);
--> statement-breakpoint
CREATE INDEX idx_additional_works_project_created ON additional_works(project_id,created_at DESC);
--> statement-breakpoint
CREATE INDEX idx_additional_works_client_status ON additional_works(client_id,status);
--> statement-breakpoint
CREATE INDEX idx_additional_works_responsible_status ON additional_works(responsible_user_id,status);
--> statement-breakpoint
INSERT INTO additional_works(id,project_id,client_id,order_id,contract_id,number,title,status,responsible_user_id,current_version_id,approved_version_id,created_by_user_id,created_at,updated_at)
SELECT legacy.additional_work_id,legacy.project_id,p.client_id,p.order_id,p.contract_id,
  'ДР-'||lpad(nextval('additional_work_number_seq')::text,6,'0'),legacy.title,
  CASE WHEN legacy.status='APPROVED' THEN 'APPROVED' WHEN legacy.status='REJECTED' THEN 'REJECTED' WHEN legacy.status='SENT' THEN 'AWAITING_CLIENT_APPROVAL' ELSE 'DRAFT' END,
  p.responsible_user_id,legacy.id,
  CASE WHEN legacy.status='APPROVED' THEN legacy.id ELSE NULL END,
  COALESCE(legacy.approved_by_user_id,p.created_by_user_id,p.responsible_user_id),legacy.created_at,legacy.updated_at
FROM (
  SELECT DISTINCT ON (additional_work_id) additional_work_id,project_id,id,title,status,approved_by_user_id,created_at,updated_at
  FROM additional_work_versions ORDER BY additional_work_id,version DESC
) legacy JOIN projects p ON p.id=legacy.project_id
ON CONFLICT(id) DO NOTHING;
--> statement-breakpoint
ALTER TABLE additional_work_versions ADD COLUMN reason text NOT NULL DEFAULT 'OTHER';
--> statement-breakpoint
ALTER TABLE additional_work_versions ADD COLUMN client_description text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE additional_work_versions ADD COLUMN internal_comment text;
--> statement-breakpoint
ALTER TABLE additional_work_versions ADD COLUMN schedule_impact_type text NOT NULL DEFAULT 'NO_IMPACT';
--> statement-breakpoint
ALTER TABLE additional_work_versions ADD COLUMN sent_at integer;
--> statement-breakpoint
ALTER TABLE additional_work_versions ADD COLUMN sent_by_user_id text;
--> statement-breakpoint
ALTER TABLE additional_work_versions ADD COLUMN rejected_at integer;
--> statement-breakpoint
ALTER TABLE additional_work_versions ADD COLUMN client_decision_comment text;
--> statement-breakpoint
ALTER TABLE additional_work_versions ADD COLUMN approved_by_client_portal_user_id text;
--> statement-breakpoint
ALTER TABLE additional_work_versions ADD COLUMN manual_approval_reason text;
--> statement-breakpoint
ALTER TABLE additional_work_versions ADD COLUMN task_creation_mode text NOT NULL DEFAULT 'NONE';
--> statement-breakpoint
ALTER TABLE additional_work_versions ADD COLUMN payment_due_date integer;
--> statement-breakpoint
ALTER TABLE additional_work_versions ADD COLUMN schedule_applied_at integer;
--> statement-breakpoint
ALTER TABLE additional_work_versions ADD COLUMN schedule_applied_by_user_id text;
--> statement-breakpoint
ALTER TABLE additional_work_versions ADD COLUMN created_by_user_id text;
--> statement-breakpoint
UPDATE additional_work_versions v SET client_description=COALESCE(NULLIF(v.client_description,''),v.title),
  schedule_impact_type=CASE WHEN v.schedule_delta_days>0 THEN 'ADD_DAYS' ELSE 'NO_IMPACT' END,
  created_by_user_id=COALESCE(v.created_by_user_id,v.approved_by_user_id,p.created_by_user_id,p.responsible_user_id)
FROM projects p WHERE p.id=v.project_id;
--> statement-breakpoint
ALTER TABLE additional_work_versions ALTER COLUMN created_by_user_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE additional_work_versions ADD CONSTRAINT additional_work_versions_container_fkey FOREIGN KEY(additional_work_id) REFERENCES additional_works(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE additional_work_versions ADD CONSTRAINT additional_work_versions_sender_fkey FOREIGN KEY(sent_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE additional_work_versions ADD CONSTRAINT additional_work_versions_portal_approver_fkey FOREIGN KEY(approved_by_client_portal_user_id) REFERENCES client_portal_users(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE additional_work_versions ADD CONSTRAINT additional_work_versions_schedule_applier_fkey FOREIGN KEY(schedule_applied_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE additional_work_versions ADD CONSTRAINT additional_work_versions_creator_fkey FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE additional_work_versions ADD CONSTRAINT additional_work_versions_status_check CHECK(status IN ('DRAFT','SENT','APPROVED','REJECTED','SUPERSEDED')) NOT VALID;
--> statement-breakpoint
ALTER TABLE additional_work_versions ADD CONSTRAINT additional_work_versions_reason_check CHECK(reason IN ('CLIENT_REQUEST','HIDDEN_CONDITION','DESIGN_CHANGE','SCOPE_CHANGE','ERROR_CORRECTION','OTHER')) NOT VALID;
--> statement-breakpoint
ALTER TABLE additional_work_versions ADD CONSTRAINT additional_work_versions_schedule_check CHECK(schedule_impact_type IN ('NO_IMPACT','ADD_DAYS','RECALCULATE') AND schedule_delta_days>=0) NOT VALID;
--> statement-breakpoint
ALTER TABLE additional_work_versions ADD CONSTRAINT additional_work_versions_task_mode_check CHECK(task_creation_mode IN ('NONE','AFTER_APPROVAL')) NOT VALID;
--> statement-breakpoint
ALTER TABLE additional_work_versions ADD CONSTRAINT additional_work_versions_amount_check CHECK(amount_kopecks>=0) NOT VALID;
--> statement-breakpoint
ALTER TABLE additional_works ADD CONSTRAINT additional_works_current_version_fkey FOREIGN KEY(current_version_id) REFERENCES additional_work_versions(id) ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE additional_works ADD CONSTRAINT additional_works_approved_version_fkey FOREIGN KEY(approved_version_id) REFERENCES additional_work_versions(id) ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE INDEX idx_additional_work_versions_container_status ON additional_work_versions(additional_work_id,status,version DESC);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_additional_work_version_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status<>'DRAFT' AND (NEW.title,NEW.amount_kopecks,NEW.schedule_delta_days,NEW.reason,NEW.client_description,NEW.internal_comment,NEW.schedule_impact_type,NEW.task_creation_mode,NEW.payment_due_date)
    IS DISTINCT FROM (OLD.title,OLD.amount_kopecks,OLD.schedule_delta_days,OLD.reason,OLD.client_description,OLD.internal_comment,OLD.schedule_impact_type,OLD.task_creation_mode,OLD.payment_due_date)
  THEN RAISE EXCEPTION 'immutable additional work version content'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER additional_work_versions_content_immutable BEFORE UPDATE ON additional_work_versions FOR EACH ROW EXECUTE FUNCTION protect_additional_work_version_content();
--> statement-breakpoint
CREATE TABLE additional_work_items (
  id text PRIMARY KEY,
  additional_work_version_id text NOT NULL,
  position integer NOT NULL,
  name text NOT NULL,
  description text,
  quantity numeric(14,3) NOT NULL,
  unit text NOT NULL,
  client_unit_price_kopecks integer NOT NULL,
  client_total_kopecks integer NOT NULL,
  internal_unit_cost_kopecks integer,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CONSTRAINT additional_work_items_version_fkey FOREIGN KEY(additional_work_version_id) REFERENCES additional_work_versions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT additional_work_items_position_unique UNIQUE(additional_work_version_id,position),
  CONSTRAINT additional_work_items_quantity_check CHECK(quantity>0),
  CONSTRAINT additional_work_items_money_check CHECK(client_unit_price_kopecks>=0 AND client_total_kopecks>=0 AND (internal_unit_cost_kopecks IS NULL OR internal_unit_cost_kopecks>=0))
);
--> statement-breakpoint
CREATE INDEX idx_additional_work_items_version ON additional_work_items(additional_work_version_id,position);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_additional_work_version_children() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE version_id text; version_status text;
BEGIN
  version_id:=CASE WHEN TG_OP='DELETE' THEN OLD.additional_work_version_id ELSE NEW.additional_work_version_id END;
  SELECT status INTO version_status FROM additional_work_versions WHERE id=version_id;
  IF version_status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'immutable additional work version children'; END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
--> statement-breakpoint
CREATE TRIGGER additional_work_items_immutable BEFORE INSERT OR UPDATE OR DELETE ON additional_work_items FOR EACH ROW EXECUTE FUNCTION protect_additional_work_version_children();
--> statement-breakpoint
CREATE TABLE additional_work_events (
  id text PRIMARY KEY,
  additional_work_id text NOT NULL,
  additional_work_version_id text,
  type text NOT NULL,
  employee_user_id text,
  client_portal_user_id text,
  comment text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at integer NOT NULL,
  CONSTRAINT additional_work_events_work_fkey FOREIGN KEY(additional_work_id) REFERENCES additional_works(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT additional_work_events_version_fkey FOREIGN KEY(additional_work_version_id) REFERENCES additional_work_versions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT additional_work_events_employee_fkey FOREIGN KEY(employee_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT additional_work_events_portal_user_fkey FOREIGN KEY(client_portal_user_id) REFERENCES client_portal_users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT additional_work_events_actor_check CHECK(employee_user_id IS NOT NULL OR client_portal_user_id IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX idx_additional_work_events_work_time ON additional_work_events(additional_work_id,occurred_at DESC);
--> statement-breakpoint
CREATE TABLE additional_work_proposed_tasks (
  id text PRIMARY KEY,
  additional_work_version_id text NOT NULL,
  stage_id text,
  position integer NOT NULL,
  title text NOT NULL,
  description text,
  progress_type text NOT NULL DEFAULT 'BINARY',
  quantity numeric(14,3),
  unit text,
  typical_duration_days integer,
  client_visible integer NOT NULL DEFAULT 1,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CONSTRAINT additional_work_proposed_tasks_version_fkey FOREIGN KEY(additional_work_version_id) REFERENCES additional_work_versions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT additional_work_proposed_tasks_stage_fkey FOREIGN KEY(stage_id) REFERENCES project_stages(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT additional_work_proposed_tasks_position_unique UNIQUE(additional_work_version_id,position),
  CONSTRAINT additional_work_proposed_tasks_progress_check CHECK(progress_type IN ('BINARY','QUANTITY')),
  CONSTRAINT additional_work_proposed_tasks_client_visible_check CHECK(client_visible IN (0,1)),
  CONSTRAINT additional_work_proposed_tasks_quantity_check CHECK(quantity IS NULL OR quantity>0),
  CONSTRAINT additional_work_proposed_tasks_duration_check CHECK(typical_duration_days IS NULL OR typical_duration_days>0)
);
--> statement-breakpoint
CREATE INDEX idx_additional_work_proposed_tasks_version ON additional_work_proposed_tasks(additional_work_version_id,position);
--> statement-breakpoint
CREATE TRIGGER additional_work_proposed_tasks_immutable BEFORE INSERT OR UPDATE OR DELETE ON additional_work_proposed_tasks FOR EACH ROW EXECUTE FUNCTION protect_additional_work_version_children();
--> statement-breakpoint
CREATE TABLE additional_work_task_links (
  id text PRIMARY KEY,
  additional_work_id text NOT NULL,
  additional_work_version_id text NOT NULL,
  proposed_task_id text NOT NULL,
  task_id text NOT NULL,
  created_at integer NOT NULL,
  CONSTRAINT additional_work_task_links_work_fkey FOREIGN KEY(additional_work_id) REFERENCES additional_works(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT additional_work_task_links_version_fkey FOREIGN KEY(additional_work_version_id) REFERENCES additional_work_versions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT additional_work_task_links_proposed_fkey FOREIGN KEY(proposed_task_id) REFERENCES additional_work_proposed_tasks(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT additional_work_task_links_task_fkey FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT additional_work_task_links_proposed_unique UNIQUE(proposed_task_id),
  CONSTRAINT additional_work_task_links_task_unique UNIQUE(task_id)
);
--> statement-breakpoint
CREATE INDEX idx_additional_work_task_links_version ON additional_work_task_links(additional_work_version_id);
--> statement-breakpoint
ALTER TABLE tasks ADD COLUMN additional_work_id text;
--> statement-breakpoint
ALTER TABLE tasks ADD COLUMN additional_work_version_id text;
--> statement-breakpoint
ALTER TABLE tasks ADD CONSTRAINT tasks_additional_work_fkey FOREIGN KEY(additional_work_id) REFERENCES additional_works(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE tasks ADD CONSTRAINT tasks_additional_work_version_fkey FOREIGN KEY(additional_work_version_id) REFERENCES additional_work_versions(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
CREATE INDEX idx_tasks_additional_work ON tasks(additional_work_id,additional_work_version_id);
--> statement-breakpoint
ALTER TABLE obligations DROP CONSTRAINT obligations_type_check;
--> statement-breakpoint
ALTER TABLE obligations ADD CONSTRAINT obligations_type_check CHECK(obligation_type IS NULL OR obligation_type IN ('STAGE_ADVANCE','STAGE_BALANCE','MANUAL','ADDITIONAL_WORK'));
--> statement-breakpoint
ALTER TABLE obligations ADD COLUMN additional_work_id text;
--> statement-breakpoint
ALTER TABLE obligations ADD COLUMN additional_work_version_id text;
--> statement-breakpoint
ALTER TABLE obligations ADD CONSTRAINT obligations_additional_work_fkey FOREIGN KEY(additional_work_id) REFERENCES additional_works(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE obligations ADD CONSTRAINT obligations_additional_work_version_fkey FOREIGN KEY(additional_work_version_id) REFERENCES additional_work_versions(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
CREATE INDEX idx_obligations_additional_work ON obligations(additional_work_id,additional_work_version_id);
--> statement-breakpoint
ALTER TABLE attachments ADD COLUMN additional_work_version_id text;
--> statement-breakpoint
ALTER TABLE attachments ADD CONSTRAINT attachments_additional_work_version_fkey FOREIGN KEY(additional_work_version_id) REFERENCES additional_work_versions(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
CREATE INDEX idx_attachments_additional_work_version ON attachments(additional_work_version_id,created_at);
--> statement-breakpoint
ALTER TABLE attachments DROP CONSTRAINT attachments_category_check;
--> statement-breakpoint
ALTER TABLE attachments ADD CONSTRAINT attachments_category_check CHECK(category IN ('RECEIPT','PROJECT_PHOTO','DAILY_REPORT','HIDDEN_WORK','CONTRACT','ACT','ESTIMATE','INSPECTION','WARRANTY','MEASUREMENT_PLAN','LAYOUT','CONCEPT','VISUALIZATION','WORKING_DRAWINGS','SPECIFICATION','FINAL_ALBUM','CONTRACT_DOCX','CONTRACT_PDF','SIGNED_CONTRACT','CONTRACT_OTHER','ADDITIONAL_WORK','OTHER'));
