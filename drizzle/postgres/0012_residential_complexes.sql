CREATE TABLE residential_complexes(
  id text PRIMARY KEY,
  name text NOT NULL,
  normalized_name text NOT NULL,
  city text NOT NULL,
  address text NOT NULL,
  developer text,
  district text,
  comment text,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_by_user_id text NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  archived_at integer,
  CONSTRAINT residential_complexes_created_by_user_id_fkey FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT residential_complexes_status_check CHECK(status IN ('ACTIVE','ARCHIVED'))
);
--> statement-breakpoint
CREATE INDEX idx_residential_complexes_name ON residential_complexes(name);
--> statement-breakpoint
CREATE INDEX idx_residential_complexes_normalized_name ON residential_complexes(normalized_name);
--> statement-breakpoint
CREATE INDEX idx_residential_complexes_status ON residential_complexes(status);
--> statement-breakpoint
CREATE INDEX idx_residential_complexes_city ON residential_complexes(city);
--> statement-breakpoint
CREATE INDEX idx_residential_complexes_address ON residential_complexes(address);
--> statement-breakpoint
ALTER TABLE inspections ADD COLUMN residential_complex_id text;
--> statement-breakpoint
ALTER TABLE inspections ADD CONSTRAINT inspections_residential_complex_id_fkey FOREIGN KEY(residential_complex_id) REFERENCES residential_complexes(id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
CREATE INDEX idx_inspections_residential_complex ON inspections(residential_complex_id);
--> statement-breakpoint
ALTER TABLE design_projects ADD CONSTRAINT design_projects_residential_complex_id_fkey FOREIGN KEY(residential_complex_id) REFERENCES residential_complexes(id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
CREATE INDEX idx_design_projects_residential_complex ON design_projects(residential_complex_id);
--> statement-breakpoint
ALTER TABLE renovation_order_details ADD CONSTRAINT renovation_order_details_residential_complex_id_fkey FOREIGN KEY(residential_complex_id) REFERENCES residential_complexes(id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
CREATE INDEX idx_renovation_order_details_residential_complex ON renovation_order_details(residential_complex_id);
--> statement-breakpoint
ALTER TABLE projects ADD COLUMN residential_complex_id text;
--> statement-breakpoint
ALTER TABLE projects ADD CONSTRAINT projects_residential_complex_id_fkey FOREIGN KEY(residential_complex_id) REFERENCES residential_complexes(id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
CREATE INDEX idx_projects_residential_complex ON projects(residential_complex_id);
