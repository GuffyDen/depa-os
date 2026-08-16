-- PostgreSQL-first stabilization migration for the existing DEPA OS production schema.
-- The legacy migrations 0000-0003 must already be present in depa_migrations.

DO $$
DECLARE
  relation record;
  orphan_count bigint;
  attachment_count bigint;
BEGIN
  SELECT COUNT(*) INTO attachment_count FROM attachments;
  IF attachment_count <> 0 THEN
    RAISE EXCEPTION 'Migration aborted: attachments contains % row(s); migrate Base64 files before removing content_base64', attachment_count;
  END IF;

  FOR relation IN SELECT * FROM (VALUES
    ('users','employee_id','employees','id'), ('users','client_id','clients','id'),
    ('auth_sessions','user_id','users','id'), ('user_permissions','user_id','users','id'),
    ('user_project_access','user_id','users','id'), ('user_project_access','project_id','projects','id'),
    ('audit_logs','actor_user_id','users','id'), ('clients','owner_employee_id','employees','id'),
    ('leads','client_id','clients','id'), ('leads','owner_employee_id','employees','id'),
    ('orders','client_id','clients','id'), ('projects','order_id','orders','id'),
    ('projects','client_id','clients','id'), ('projects','manager_employee_id','employees','id'),
    ('projects','foreman_employee_id','employees','id'), ('cashboxes','owner_user_id','users','id'),
    ('cashboxes','owner_employee_id','employees','id'), ('cashboxes','deactivated_by_user_id','users','id'),
    ('financial_transactions','author_user_id','users','id'), ('financial_transactions','cashbox_id','cashboxes','id'),
    ('financial_transactions','destination_cashbox_id','cashboxes','id'), ('financial_transactions','original_transaction_id','financial_transactions','id'),
    ('financial_transactions','client_id','clients','id'), ('financial_transactions','project_id','projects','id'),
    ('financial_transactions','order_id','orders','id'), ('transaction_allocations','transaction_id','financial_transactions','id'),
    ('transaction_allocations','project_id','projects','id'), ('transaction_allocations','order_id','orders','id'),
    ('project_stages','project_id','projects','id'), ('project_stages','responsible_employee_id','employees','id'),
    ('project_delays','project_id','projects','id'), ('project_delays','stage_id','project_stages','id'),
    ('tasks','created_by_user_id','users','id'), ('tasks','assignee_employee_id','employees','id'),
    ('tasks','project_id','projects','id'), ('tasks','client_id','clients','id'), ('tasks','lead_id','leads','id'),
    ('contractor_agreements','project_id','projects','id'), ('contractor_agreements','contractor_id','contractors','id'),
    ('estimate_versions','project_id','projects','id'), ('estimate_versions','created_by_user_id','users','id'),
    ('additional_work_versions','project_id','projects','id'), ('additional_work_versions','approved_by_client_id','clients','id'),
    ('additional_work_versions','approved_by_user_id','users','id'), ('daily_reports','project_id','projects','id'),
    ('daily_reports','author_employee_id','employees','id'), ('daily_reports','created_by_user_id','users','id'),
    ('obligations','project_id','projects','id')
  ) AS r(source_table, source_column, target_table, target_column)
  LOOP
    EXECUTE format('SELECT COUNT(*) FROM %I s LEFT JOIN %I t ON t.%I=s.%I WHERE s.%I IS NOT NULL AND t.%I IS NULL',
      relation.source_table, relation.target_table, relation.target_column, relation.source_column, relation.source_column, relation.target_column)
      INTO orphan_count;
    IF orphan_count <> 0 THEN
      RAISE EXCEPTION 'Migration aborted: %.% has % orphan row(s) relative to %.%', relation.source_table, relation.source_column, orphan_count, relation.target_table, relation.target_column;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM users GROUP BY username HAVING COUNT(*) > 1) THEN RAISE EXCEPTION 'Migration aborted: duplicate users.username'; END IF;
  IF EXISTS (SELECT 1 FROM users GROUP BY username_normalized HAVING COUNT(*) > 1) THEN RAISE EXCEPTION 'Migration aborted: duplicate users.username_normalized'; END IF;
  IF EXISTS (SELECT 1 FROM users WHERE employee_id IS NOT NULL GROUP BY employee_id HAVING COUNT(*) > 1) THEN RAISE EXCEPTION 'Migration aborted: duplicate users.employee_id'; END IF;
  IF EXISTS (SELECT 1 FROM cashboxes WHERE owner_user_id IS NOT NULL GROUP BY owner_user_id HAVING COUNT(*) > 1) THEN RAISE EXCEPTION 'Migration aborted: duplicate cashboxes.owner_user_id'; END IF;
END $$;
--> statement-breakpoint
UPDATE employees SET full_name='Денис Учайкин',updated_at=CAST(EXTRACT(EPOCH FROM NOW()) AS integer) WHERE id='employee_owner_denis' AND full_name='Денис';
--> statement-breakpoint
UPDATE employees SET full_name='Павел Костенко',updated_at=CAST(EXTRACT(EPOCH FROM NOW()) AS integer) WHERE id='employee_owner_pavel' AND full_name='Паша';
--> statement-breakpoint
ALTER TABLE users ADD CONSTRAINT users_username_unique UNIQUE (username);
--> statement-breakpoint
ALTER TABLE users ADD CONSTRAINT users_username_normalized_unique UNIQUE USING INDEX idx_users_username_normalized;
--> statement-breakpoint
ALTER TABLE users ADD CONSTRAINT users_employee_id_unique UNIQUE (employee_id);
--> statement-breakpoint
DROP INDEX IF EXISTS idx_users_employee;
--> statement-breakpoint
ALTER TABLE cashboxes ADD CONSTRAINT cashboxes_owner_user_id_unique UNIQUE USING INDEX idx_cashboxes_owner_user;
--> statement-breakpoint
ALTER TABLE attachments RENAME COLUMN file_name TO original_filename;
--> statement-breakpoint
ALTER TABLE attachments DROP COLUMN kind, DROP COLUMN content_base64,
  ADD COLUMN storage_provider text DEFAULT 'VERCEL_BLOB' NOT NULL,
  ADD COLUMN blob_url text,
  ADD COLUMN checksum_sha256 text,
  ADD COLUMN uploaded_by_user_id text NOT NULL,
  ADD COLUMN entity_type text NOT NULL,
  ADD COLUMN entity_id text,
  ADD COLUMN category text NOT NULL,
  ADD COLUMN visibility text DEFAULT 'INTERNAL' NOT NULL,
  ADD COLUMN upload_status text DEFAULT 'PENDING' NOT NULL,
  ADD COLUMN metadata_json jsonb DEFAULT '{}'::jsonb NOT NULL,
  ADD COLUMN completed_at integer,
  ADD COLUMN linked_at integer,
  ADD COLUMN deleted_at integer,
  ADD COLUMN deleted_by_user_id text;
--> statement-breakpoint
ALTER TABLE attachments ALTER COLUMN size_bytes SET DEFAULT 0,
  ADD CONSTRAINT attachments_storage_key_unique UNIQUE (storage_key),
  ADD CONSTRAINT attachments_provider_check CHECK (storage_provider='VERCEL_BLOB'),
  ADD CONSTRAINT attachments_category_check CHECK (category IN ('RECEIPT','PROJECT_PHOTO','DAILY_REPORT','HIDDEN_WORK','CONTRACT','ACT','ESTIMATE','INSPECTION','WARRANTY','OTHER')),
  ADD CONSTRAINT attachments_visibility_check CHECK (visibility IN ('INTERNAL','PROJECT','CLIENT')),
  ADD CONSTRAINT attachments_status_check CHECK (upload_status IN ('PENDING','UPLOADED','LINKED','FAILED','DELETED')),
  ADD CONSTRAINT attachments_size_check CHECK (size_bytes>=0);
--> statement-breakpoint
ALTER TABLE additional_work_versions ADD CONSTRAINT additional_work_versions_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE additional_work_versions ADD CONSTRAINT additional_work_versions_approved_by_client_id_clients_id_fk FOREIGN KEY (approved_by_client_id) REFERENCES clients(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE additional_work_versions ADD CONSTRAINT additional_work_versions_approved_by_user_id_users_id_fk FOREIGN KEY (approved_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE attachments ADD CONSTRAINT attachments_transaction_id_financial_transactions_id_fk FOREIGN KEY (transaction_id) REFERENCES financial_transactions(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE attachments ADD CONSTRAINT attachments_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE attachments ADD CONSTRAINT attachments_uploaded_by_user_id_users_id_fk FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE attachments ADD CONSTRAINT attachments_deleted_by_user_id_users_id_fk FOREIGN KEY (deleted_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_actor_user_id_users_id_fk FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE cashboxes ADD CONSTRAINT cashboxes_owner_user_id_users_id_fk FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE cashboxes ADD CONSTRAINT cashboxes_owner_employee_id_employees_id_fk FOREIGN KEY (owner_employee_id) REFERENCES employees(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE cashboxes ADD CONSTRAINT cashboxes_deactivated_by_user_id_users_id_fk FOREIGN KEY (deactivated_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE clients ADD CONSTRAINT clients_owner_employee_id_employees_id_fk FOREIGN KEY (owner_employee_id) REFERENCES employees(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE contractor_agreements ADD CONSTRAINT contractor_agreements_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE contractor_agreements ADD CONSTRAINT contractor_agreements_contractor_id_contractors_id_fk FOREIGN KEY (contractor_id) REFERENCES contractors(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE daily_reports ADD CONSTRAINT daily_reports_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE daily_reports ADD CONSTRAINT daily_reports_author_employee_id_employees_id_fk FOREIGN KEY (author_employee_id) REFERENCES employees(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE daily_reports ADD CONSTRAINT daily_reports_created_by_user_id_users_id_fk FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE estimate_versions ADD CONSTRAINT estimate_versions_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE estimate_versions ADD CONSTRAINT estimate_versions_created_by_user_id_users_id_fk FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE financial_transactions ADD CONSTRAINT financial_transactions_author_user_id_users_id_fk FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE financial_transactions ADD CONSTRAINT financial_transactions_cashbox_id_cashboxes_id_fk FOREIGN KEY (cashbox_id) REFERENCES cashboxes(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE financial_transactions ADD CONSTRAINT financial_transactions_destination_cashbox_id_cashboxes_id_fk FOREIGN KEY (destination_cashbox_id) REFERENCES cashboxes(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE financial_transactions ADD CONSTRAINT financial_transactions_client_id_clients_id_fk FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE financial_transactions ADD CONSTRAINT financial_transactions_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE financial_transactions ADD CONSTRAINT financial_transactions_order_id_orders_id_fk FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE financial_transactions ADD CONSTRAINT financial_transactions_original_transaction_id_fkey FOREIGN KEY (original_transaction_id) REFERENCES financial_transactions(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE leads ADD CONSTRAINT leads_client_id_clients_id_fk FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE leads ADD CONSTRAINT leads_owner_employee_id_employees_id_fk FOREIGN KEY (owner_employee_id) REFERENCES employees(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE obligations ADD CONSTRAINT obligations_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE orders ADD CONSTRAINT orders_client_id_clients_id_fk FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE project_delays ADD CONSTRAINT project_delays_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE project_delays ADD CONSTRAINT project_delays_stage_id_project_stages_id_fk FOREIGN KEY (stage_id) REFERENCES project_stages(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE project_stages ADD CONSTRAINT project_stages_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE project_stages ADD CONSTRAINT project_stages_responsible_employee_id_employees_id_fk FOREIGN KEY (responsible_employee_id) REFERENCES employees(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE projects ADD CONSTRAINT projects_order_id_orders_id_fk FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE projects ADD CONSTRAINT projects_client_id_clients_id_fk FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE projects ADD CONSTRAINT projects_manager_employee_id_employees_id_fk FOREIGN KEY (manager_employee_id) REFERENCES employees(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE projects ADD CONSTRAINT projects_foreman_employee_id_employees_id_fk FOREIGN KEY (foreman_employee_id) REFERENCES employees(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE tasks ADD CONSTRAINT tasks_created_by_user_id_users_id_fk FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE tasks ADD CONSTRAINT tasks_assignee_employee_id_employees_id_fk FOREIGN KEY (assignee_employee_id) REFERENCES employees(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE tasks ADD CONSTRAINT tasks_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE tasks ADD CONSTRAINT tasks_client_id_clients_id_fk FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE tasks ADD CONSTRAINT tasks_lead_id_leads_id_fk FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE transaction_allocations ADD CONSTRAINT transaction_allocations_transaction_id_financial_transactions_id_fk FOREIGN KEY (transaction_id) REFERENCES financial_transactions(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE transaction_allocations ADD CONSTRAINT transaction_allocations_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE transaction_allocations ADD CONSTRAINT transaction_allocations_order_id_orders_id_fk FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE user_permissions ADD CONSTRAINT user_permissions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE user_project_access ADD CONSTRAINT user_project_access_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE user_project_access ADD CONSTRAINT user_project_access_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE users ADD CONSTRAINT users_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE users ADD CONSTRAINT users_client_id_clients_id_fk FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
--> statement-breakpoint
DO $$ DECLARE c record; BEGIN FOR c IN SELECT conrelid::regclass AS table_name, conname FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace AND NOT convalidated LOOP EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', c.table_name, c.conname); END LOOP; END $$;
--> statement-breakpoint
CREATE INDEX idx_attachments_entity ON attachments(entity_type,entity_id);
--> statement-breakpoint
CREATE INDEX idx_attachments_uploaded_by ON attachments(uploaded_by_user_id);
--> statement-breakpoint
CREATE INDEX idx_attachments_created_at ON attachments(created_at);
--> statement-breakpoint
CREATE INDEX idx_attachments_status_created ON attachments(upload_status,created_at);
--> statement-breakpoint
CREATE INDEX idx_audit_created_at ON audit_logs(occurred_at);
--> statement-breakpoint
CREATE INDEX idx_auth_sessions_expires ON auth_sessions(expires_at);
--> statement-breakpoint
CREATE INDEX idx_cashboxes_owner_employee ON cashboxes(owner_employee_id);
--> statement-breakpoint
CREATE INDEX idx_cashboxes_deactivated_by ON cashboxes(deactivated_by_user_id);
--> statement-breakpoint
CREATE INDEX idx_transactions_author ON financial_transactions(author_user_id);
--> statement-breakpoint
CREATE INDEX idx_transactions_order ON financial_transactions(order_id);
--> statement-breakpoint
CREATE INDEX idx_transactions_created_at ON financial_transactions(created_at);
--> statement-breakpoint
CREATE INDEX idx_allocations_order ON transaction_allocations(order_id);
--> statement-breakpoint
CREATE INDEX idx_projects_order ON projects(order_id);
--> statement-breakpoint
CREATE INDEX idx_projects_manager ON projects(manager_employee_id);
--> statement-breakpoint
CREATE INDEX idx_projects_foreman ON projects(foreman_employee_id);
--> statement-breakpoint
CREATE INDEX idx_tasks_client ON tasks(client_id);
--> statement-breakpoint
CREATE INDEX idx_tasks_lead ON tasks(lead_id);
--> statement-breakpoint
CREATE INDEX idx_tasks_due_date ON tasks(deadline);
--> statement-breakpoint
CREATE INDEX idx_stages_responsible ON project_stages(responsible_employee_id);
--> statement-breakpoint
CREATE INDEX idx_delays_stage ON project_delays(stage_id);
--> statement-breakpoint
CREATE INDEX idx_agreements_contractor ON contractor_agreements(contractor_id);
--> statement-breakpoint
CREATE INDEX idx_estimate_creator ON estimate_versions(created_by_user_id);
--> statement-breakpoint
CREATE INDEX idx_additional_work_client_approver ON additional_work_versions(approved_by_client_id);
--> statement-breakpoint
CREATE INDEX idx_additional_work_user_approver ON additional_work_versions(approved_by_user_id);
--> statement-breakpoint
CREATE INDEX idx_daily_report_author ON daily_reports(author_employee_id);
--> statement-breakpoint
CREATE INDEX idx_obligations_project ON obligations(project_id);
--> statement-breakpoint
CREATE INDEX idx_user_project_access_project ON user_project_access(project_id);
--> statement-breakpoint
CREATE INDEX idx_users_client ON users(client_id);
