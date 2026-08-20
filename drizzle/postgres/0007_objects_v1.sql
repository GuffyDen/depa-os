ALTER TABLE projects ALTER COLUMN order_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE projects ADD COLUMN IF NOT EXISTS area_sqm numeric(8,2);
--> statement-breakpoint
ALTER TABLE projects ADD COLUMN IF NOT EXISTS responsible_user_id text;
--> statement-breakpoint
ALTER TABLE projects ADD COLUMN IF NOT EXISTS estimated_materials_budget_kopecks integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_by_user_id text;
--> statement-breakpoint
ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at integer;
--> statement-breakpoint
UPDATE projects SET address=COALESCE(NULLIF(trim(address),''),'Адрес не указан'),apartment=COALESCE(NULLIF(trim(apartment),''),'—');
--> statement-breakpoint
UPDATE projects p SET responsible_user_id=u.id FROM users u WHERE p.responsible_user_id IS NULL AND p.manager_employee_id=u.employee_id;
--> statement-breakpoint
UPDATE projects SET responsible_user_id=(SELECT id FROM users WHERE role='OWNER' AND status='ACTIVE' ORDER BY created_at LIMIT 1) WHERE responsible_user_id IS NULL;
--> statement-breakpoint
UPDATE projects SET created_by_user_id=responsible_user_id WHERE created_by_user_id IS NULL;
--> statement-breakpoint
UPDATE projects SET status=CASE WHEN status IN ('PLANNING','ACTIVE','PAUSED','COMPLETED','ARCHIVED') THEN status WHEN status IN ('IN_PROGRESS','WORKING') THEN 'ACTIVE' WHEN status IN ('DONE','FINISHED') THEN 'COMPLETED' ELSE 'PLANNING' END;
--> statement-breakpoint
ALTER TABLE projects ALTER COLUMN address SET NOT NULL;
--> statement-breakpoint
ALTER TABLE projects ALTER COLUMN apartment SET NOT NULL;
--> statement-breakpoint
ALTER TABLE projects ALTER COLUMN responsible_user_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE projects ALTER COLUMN created_by_user_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE projects ALTER COLUMN status SET DEFAULT 'PLANNING';
--> statement-breakpoint
ALTER TABLE projects ADD CONSTRAINT projects_responsible_user_id_fkey FOREIGN KEY (responsible_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE projects ADD CONSTRAINT projects_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE projects ADD CONSTRAINT projects_status_check CHECK (status IN ('PLANNING','ACTIVE','PAUSED','COMPLETED','ARCHIVED'));
--> statement-breakpoint
ALTER TABLE projects ADD CONSTRAINT projects_area_sqm_check CHECK (area_sqm IS NULL OR area_sqm > 0);
--> statement-breakpoint
ALTER TABLE projects ADD CONSTRAINT projects_contract_amount_check CHECK (contract_amount_kopecks >= 0);
--> statement-breakpoint
ALTER TABLE projects ADD CONSTRAINT projects_materials_budget_check CHECK (estimated_materials_budget_kopecks >= 0);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_projects_responsible_status_created ON projects(responsible_user_id,status,created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_projects_foreman_status ON projects(foreman_employee_id,status);
