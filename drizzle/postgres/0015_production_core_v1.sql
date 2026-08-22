CREATE TABLE production_plans (
  id text PRIMARY KEY,
  project_id text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'ACTIVE',
  source_template_id text,
  source_template_version integer,
  design_weight numeric(5,2) NOT NULL DEFAULT 0,
  production_weight numeric(5,2) NOT NULL DEFAULT 100,
  created_by_user_id text NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CONSTRAINT production_plans_project_fkey FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT production_plans_creator_fkey FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT production_plans_status_check CHECK(status IN ('ACTIVE','ARCHIVED')),
  CONSTRAINT production_plans_weight_check CHECK(design_weight>=0 AND production_weight>=0 AND design_weight+production_weight=100)
);
--> statement-breakpoint
ALTER TABLE projects ADD COLUMN internal_forecast_end_date integer;
--> statement-breakpoint
ALTER TABLE projects ADD COLUMN published_forecast_end_date integer;
--> statement-breakpoint
ALTER TABLE projects ADD COLUMN daily_report_responsible_user_id text;
--> statement-breakpoint
ALTER TABLE projects ADD CONSTRAINT projects_daily_report_responsible_fkey FOREIGN KEY(daily_report_responsible_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE project_stages ADD COLUMN production_plan_id text;
--> statement-breakpoint
ALTER TABLE project_stages ADD COLUMN weight_within_project numeric(5,2) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE project_stages ADD COLUMN responsible_user_id text;
--> statement-breakpoint
ALTER TABLE project_stages ADD COLUMN client_acceptance_required integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE project_stages ADD COLUMN acceptance_status text NOT NULL DEFAULT 'NOT_REQUIRED';
--> statement-breakpoint
ALTER TABLE project_stages ADD COLUMN stage_commercial_amount_kopecks integer;
--> statement-breakpoint
ALTER TABLE project_stages ADD COLUMN acceptance_comment text;
--> statement-breakpoint
ALTER TABLE project_stages ADD COLUMN accepted_at integer;
--> statement-breakpoint
ALTER TABLE project_stages ADD COLUMN rejected_at integer;
--> statement-breakpoint
ALTER TABLE project_stages ADD COLUMN acceptance_by_client_id text;
--> statement-breakpoint
ALTER TABLE project_stages ADD COLUMN archived_at integer;
--> statement-breakpoint
ALTER TABLE project_stages ADD CONSTRAINT project_stages_plan_fkey FOREIGN KEY(production_plan_id) REFERENCES production_plans(id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE project_stages ADD CONSTRAINT project_stages_responsible_user_fkey FOREIGN KEY(responsible_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE project_stages ADD CONSTRAINT project_stages_weight_check CHECK(weight_within_project>=0 AND weight_within_project<=100);
--> statement-breakpoint
ALTER TABLE project_stages ADD CONSTRAINT project_stages_acceptance_check CHECK(acceptance_status IN ('NOT_REQUIRED','NOT_READY','AWAITING_ACCEPTANCE','ACCEPTED','REJECTED'));
--> statement-breakpoint
ALTER TABLE tasks ADD COLUMN production_plan_id text;
--> statement-breakpoint
ALTER TABLE tasks ADD COLUMN stage_id text;
--> statement-breakpoint
ALTER TABLE tasks ADD COLUMN description text;
--> statement-breakpoint
ALTER TABLE tasks ADD COLUMN position integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE tasks ADD COLUMN progress_type text;
--> statement-breakpoint
ALTER TABLE tasks ADD COLUMN unit text;
--> statement-breakpoint
ALTER TABLE tasks ADD COLUMN planned_quantity numeric(14,2);
--> statement-breakpoint
ALTER TABLE tasks ADD COLUMN completed_quantity numeric(14,2);
--> statement-breakpoint
ALTER TABLE tasks ADD COLUMN weight_within_stage numeric(5,2);
--> statement-breakpoint
ALTER TABLE tasks ADD COLUMN planned_start_date integer;
--> statement-breakpoint
ALTER TABLE tasks ADD COLUMN planned_end_date integer;
--> statement-breakpoint
ALTER TABLE tasks ADD COLUMN actual_start_date integer;
--> statement-breakpoint
ALTER TABLE tasks ADD COLUMN actual_end_date integer;
--> statement-breakpoint
ALTER TABLE tasks ADD COLUMN responsible_user_id text;
--> statement-breakpoint
ALTER TABLE tasks ADD COLUMN planned_duration_days integer;
--> statement-breakpoint
ALTER TABLE tasks ADD COLUMN client_visible integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE tasks ADD COLUMN archived_at integer;
--> statement-breakpoint
ALTER TABLE tasks ADD CONSTRAINT tasks_production_plan_fkey FOREIGN KEY(production_plan_id) REFERENCES production_plans(id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE tasks ADD CONSTRAINT tasks_stage_fkey FOREIGN KEY(stage_id) REFERENCES project_stages(id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE tasks ADD CONSTRAINT tasks_responsible_user_fkey FOREIGN KEY(responsible_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE tasks ADD CONSTRAINT tasks_progress_type_check CHECK(progress_type IS NULL OR progress_type IN ('BINARY','QUANTITY'));
--> statement-breakpoint
ALTER TABLE tasks ADD CONSTRAINT tasks_quantity_check CHECK((planned_quantity IS NULL OR planned_quantity>=0) AND (completed_quantity IS NULL OR completed_quantity>=0));
--> statement-breakpoint
ALTER TABLE tasks ADD CONSTRAINT tasks_weight_check CHECK(weight_within_stage IS NULL OR (weight_within_stage>=0 AND weight_within_stage<=100));
--> statement-breakpoint
CREATE TABLE task_dependencies (
  id text PRIMARY KEY, project_id text NOT NULL, predecessor_task_id text NOT NULL, successor_task_id text NOT NULL,
  type text NOT NULL DEFAULT 'FINISH_TO_START', lag_days integer NOT NULL DEFAULT 0, created_by_user_id text NOT NULL, created_at integer NOT NULL,
  CONSTRAINT task_dependencies_project_fkey FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT task_dependencies_predecessor_fkey FOREIGN KEY(predecessor_task_id) REFERENCES tasks(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT task_dependencies_successor_fkey FOREIGN KEY(successor_task_id) REFERENCES tasks(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT task_dependencies_creator_fkey FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT task_dependencies_unique UNIQUE(predecessor_task_id,successor_task_id),
  CONSTRAINT task_dependencies_self_check CHECK(predecessor_task_id<>successor_task_id),
  CONSTRAINT task_dependencies_type_check CHECK(type='FINISH_TO_START'),
  CONSTRAINT task_dependencies_lag_check CHECK(lag_days>=0)
);
--> statement-breakpoint
CREATE TABLE task_contractors (
  id text PRIMARY KEY, task_id text NOT NULL, contractor_agreement_id text NOT NULL, created_at integer NOT NULL,
  CONSTRAINT task_contractors_task_fkey FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT task_contractors_agreement_fkey FOREIGN KEY(contractor_agreement_id) REFERENCES contractor_agreements(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT task_contractors_unique UNIQUE(task_id,contractor_agreement_id)
);
--> statement-breakpoint
ALTER TABLE daily_reports ADD COLUMN author_user_id text;
--> statement-breakpoint
ALTER TABLE daily_reports ADD COLUMN comment_client_visible integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE daily_reports ADD CONSTRAINT daily_reports_author_user_fkey FOREIGN KEY(author_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
CREATE TABLE daily_report_workers (
  id text PRIMARY KEY, daily_report_id text NOT NULL, worker_type text NOT NULL, employee_id text, contractor_id text, created_at integer NOT NULL,
  CONSTRAINT daily_report_workers_report_fkey FOREIGN KEY(daily_report_id) REFERENCES daily_reports(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT daily_report_workers_employee_fkey FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT daily_report_workers_contractor_fkey FOREIGN KEY(contractor_id) REFERENCES contractors(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT daily_report_workers_type_check CHECK((worker_type='EMPLOYEE' AND employee_id IS NOT NULL AND contractor_id IS NULL) OR (worker_type='CONTRACTOR' AND contractor_id IS NOT NULL AND employee_id IS NULL))
);
--> statement-breakpoint
CREATE TABLE daily_report_tasks (
  id text PRIMARY KEY, daily_report_id text NOT NULL, task_id text NOT NULL, created_at integer NOT NULL,
  CONSTRAINT daily_report_tasks_report_fkey FOREIGN KEY(daily_report_id) REFERENCES daily_reports(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT daily_report_tasks_task_fkey FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT daily_report_tasks_unique UNIQUE(daily_report_id,task_id)
);
--> statement-breakpoint
CREATE TABLE task_photo_requirements (
  id text PRIMARY KEY, task_id text NOT NULL, name text NOT NULL, description text, type text NOT NULL DEFAULT 'HIDDEN_WORK', required_before_completion integer NOT NULL DEFAULT 1, position integer NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL,
  CONSTRAINT task_photo_requirements_task_fkey FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT task_photo_requirements_type_check CHECK(type='HIDDEN_WORK')
);
--> statement-breakpoint
ALTER TABLE attachments ADD COLUMN photo_requirement_id text;
--> statement-breakpoint
ALTER TABLE attachments ADD CONSTRAINT attachments_photo_requirement_fkey FOREIGN KEY(photo_requirement_id) REFERENCES task_photo_requirements(id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE project_delays ADD COLUMN task_id text;
--> statement-breakpoint
ALTER TABLE project_delays ADD COLUMN category text NOT NULL DEFAULT 'OTHER';
--> statement-breakpoint
ALTER TABLE project_delays ADD COLUMN internal_comment text;
--> statement-breakpoint
ALTER TABLE project_delays ADD COLUMN client_comment text;
--> statement-breakpoint
ALTER TABLE project_delays ADD COLUMN client_visible integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE project_delays ADD COLUMN created_by_user_id text;
--> statement-breakpoint
ALTER TABLE project_delays ADD CONSTRAINT project_delays_task_fkey FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE project_delays ADD CONSTRAINT project_delays_creator_fkey FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE project_delays ADD CONSTRAINT project_delays_category_check CHECK(category IN ('CLIENT','MATERIALS','CONTRACTOR','DEPA','DESIGN','EXTERNAL','OTHER'));
--> statement-breakpoint
CREATE TABLE production_plan_templates (
  id text PRIMARY KEY, name text NOT NULL, status text NOT NULL DEFAULT 'ACTIVE', version integer NOT NULL DEFAULT 1, created_by_user_id text NOT NULL, archived_at integer, created_at integer NOT NULL, updated_at integer NOT NULL,
  CONSTRAINT production_templates_creator_fkey FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT production_templates_status_check CHECK(status IN ('ACTIVE','ARCHIVED'))
);
--> statement-breakpoint
CREATE TABLE production_stage_templates (
  id text PRIMARY KEY, template_id text NOT NULL, name text NOT NULL, position integer NOT NULL, weight numeric(5,2) NOT NULL, client_acceptance_required integer NOT NULL DEFAULT 0, created_at integer NOT NULL, updated_at integer NOT NULL,
  CONSTRAINT production_stage_templates_template_fkey FOREIGN KEY(template_id) REFERENCES production_plan_templates(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
--> statement-breakpoint
ALTER TABLE production_plans ADD CONSTRAINT production_plans_source_template_fkey FOREIGN KEY(source_template_id) REFERENCES production_plan_templates(id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
CREATE TABLE production_task_templates (
  id text PRIMARY KEY, stage_template_id text NOT NULL, name text NOT NULL, description text, position integer NOT NULL, weight numeric(5,2) NOT NULL, progress_type text NOT NULL, unit text, typical_quantity numeric(14,2), typical_duration_days integer NOT NULL, client_visible integer NOT NULL DEFAULT 1, created_at integer NOT NULL, updated_at integer NOT NULL,
  CONSTRAINT production_task_templates_stage_fkey FOREIGN KEY(stage_template_id) REFERENCES production_stage_templates(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT production_task_templates_progress_check CHECK(progress_type IN ('BINARY','QUANTITY')),
  CONSTRAINT production_task_templates_duration_check CHECK(typical_duration_days>0)
);
--> statement-breakpoint
CREATE TABLE production_task_dependency_templates (
  id text PRIMARY KEY, template_id text NOT NULL, predecessor_task_template_id text NOT NULL, successor_task_template_id text NOT NULL, lag_days integer NOT NULL DEFAULT 0, created_at integer NOT NULL,
  CONSTRAINT production_dependency_templates_template_fkey FOREIGN KEY(template_id) REFERENCES production_plan_templates(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT production_dependency_templates_predecessor_fkey FOREIGN KEY(predecessor_task_template_id) REFERENCES production_task_templates(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT production_dependency_templates_successor_fkey FOREIGN KEY(successor_task_template_id) REFERENCES production_task_templates(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT production_dependency_templates_unique UNIQUE(predecessor_task_template_id,successor_task_template_id)
);
--> statement-breakpoint
CREATE TABLE production_photo_requirement_templates (
  id text PRIMARY KEY, task_template_id text NOT NULL, name text NOT NULL, description text, position integer NOT NULL, required_before_completion integer NOT NULL DEFAULT 1, created_at integer NOT NULL,
  CONSTRAINT production_photo_templates_task_fkey FOREIGN KEY(task_template_id) REFERENCES production_task_templates(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
--> statement-breakpoint
CREATE TABLE project_schedule_events (
  id text PRIMARY KEY, project_id text NOT NULL, actor_user_id text NOT NULL, type text NOT NULL, previous_forecast_end_date integer, new_forecast_end_date integer, reason text, metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb, occurred_at integer NOT NULL,
  CONSTRAINT project_schedule_events_project_fkey FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT project_schedule_events_actor_fkey FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
--> statement-breakpoint
CREATE INDEX idx_production_plans_project ON production_plans(project_id);
--> statement-breakpoint
CREATE INDEX idx_stages_plan_position ON project_stages(production_plan_id,sort_order);
--> statement-breakpoint
CREATE INDEX idx_tasks_stage_position ON tasks(stage_id,position);
--> statement-breakpoint
CREATE INDEX idx_tasks_production_status ON tasks(project_id,status);
--> statement-breakpoint
CREATE INDEX idx_tasks_responsible_user ON tasks(responsible_user_id);
--> statement-breakpoint
CREATE INDEX idx_tasks_planned_dates ON tasks(planned_start_date,planned_end_date);
--> statement-breakpoint
CREATE INDEX idx_task_dependencies_predecessor ON task_dependencies(predecessor_task_id);
--> statement-breakpoint
CREATE INDEX idx_task_dependencies_successor ON task_dependencies(successor_task_id);
--> statement-breakpoint
CREATE INDEX idx_daily_report_workers_report ON daily_report_workers(daily_report_id);
--> statement-breakpoint
CREATE INDEX idx_daily_report_tasks_report ON daily_report_tasks(daily_report_id);
--> statement-breakpoint
CREATE INDEX idx_photo_requirements_task ON task_photo_requirements(task_id,position);
--> statement-breakpoint
CREATE INDEX idx_project_delays_task ON project_delays(task_id);
--> statement-breakpoint
CREATE INDEX idx_production_templates_status ON production_plan_templates(status);
--> statement-breakpoint
CREATE INDEX idx_schedule_events_project_time ON project_schedule_events(project_id,occurred_at DESC);
