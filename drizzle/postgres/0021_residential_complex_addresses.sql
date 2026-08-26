CREATE TABLE residential_complex_addresses (
  id text PRIMARY KEY,
  residential_complex_id text NOT NULL,
  address text NOT NULL,
  normalized_address text NOT NULL,
  position integer NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CONSTRAINT residential_complex_addresses_complex_fkey FOREIGN KEY(residential_complex_id) REFERENCES residential_complexes(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT residential_complex_addresses_address_check CHECK(length(trim(address)) > 0),
  CONSTRAINT residential_complex_addresses_normalized_check CHECK(length(trim(normalized_address)) > 0),
  CONSTRAINT residential_complex_addresses_position_check CHECK(position >= 0),
  CONSTRAINT residential_complex_addresses_identity_unique UNIQUE(id, residential_complex_id),
  CONSTRAINT residential_complex_addresses_value_unique UNIQUE(residential_complex_id, normalized_address),
  CONSTRAINT residential_complex_addresses_position_unique UNIQUE(residential_complex_id, position)
);
--> statement-breakpoint
CREATE INDEX idx_residential_complex_addresses_complex ON residential_complex_addresses(residential_complex_id, position, id);
--> statement-breakpoint
CREATE INDEX idx_residential_complex_addresses_search ON residential_complex_addresses(normalized_address);
--> statement-breakpoint
INSERT INTO residential_complex_addresses(id,residential_complex_id,address,normalized_address,position,created_at,updated_at)
SELECT 'rca_' || md5(id || ':0'),id,trim(address),lower(regexp_replace(trim(address),'[[:space:]]+',' ','g')),0,created_at,updated_at
FROM residential_complexes;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM residential_complexes rc
    LEFT JOIN residential_complex_addresses rca ON rca.residential_complex_id=rc.id
    GROUP BY rc.id HAVING count(rca.id)<>1
  ) THEN RAISE EXCEPTION 'Residential Complex address backfill failed'; END IF;
END $$;
--> statement-breakpoint
ALTER TABLE inspections ADD COLUMN residential_complex_address_id text;
--> statement-breakpoint
ALTER TABLE design_projects ADD COLUMN residential_complex_address_id text;
--> statement-breakpoint
ALTER TABLE renovation_order_details ADD COLUMN residential_complex_address_id text;
--> statement-breakpoint
ALTER TABLE projects ADD COLUMN residential_complex_address_id text;
--> statement-breakpoint
ALTER TABLE estimates ADD COLUMN residential_complex_address_id text;
--> statement-breakpoint
UPDATE inspections entity SET residential_complex_address_id=rca.id FROM residential_complex_addresses rca WHERE entity.residential_complex_id=rca.residential_complex_id AND lower(regexp_replace(trim(entity.address),'[[:space:]]+',' ','g'))=rca.normalized_address;
--> statement-breakpoint
UPDATE design_projects entity SET residential_complex_address_id=rca.id FROM residential_complex_addresses rca WHERE entity.residential_complex_id=rca.residential_complex_id AND lower(regexp_replace(trim(entity.address),'[[:space:]]+',' ','g'))=rca.normalized_address;
--> statement-breakpoint
UPDATE renovation_order_details entity SET residential_complex_address_id=rca.id FROM residential_complex_addresses rca WHERE entity.residential_complex_id=rca.residential_complex_id AND lower(regexp_replace(trim(entity.address),'[[:space:]]+',' ','g'))=rca.normalized_address;
--> statement-breakpoint
UPDATE projects entity SET residential_complex_address_id=rca.id FROM residential_complex_addresses rca WHERE entity.residential_complex_id=rca.residential_complex_id AND lower(regexp_replace(trim(entity.address),'[[:space:]]+',' ','g'))=rca.normalized_address;
--> statement-breakpoint
UPDATE estimates entity SET residential_complex_address_id=rca.id FROM residential_complex_addresses rca WHERE entity.residential_complex_id=rca.residential_complex_id AND lower(regexp_replace(trim(entity.address),'[[:space:]]+',' ','g'))=rca.normalized_address;
--> statement-breakpoint
ALTER TABLE inspections ADD CONSTRAINT inspections_residential_complex_address_fkey FOREIGN KEY(residential_complex_address_id) REFERENCES residential_complex_addresses(id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE design_projects ADD CONSTRAINT design_projects_residential_complex_address_fkey FOREIGN KEY(residential_complex_address_id) REFERENCES residential_complex_addresses(id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE renovation_order_details ADD CONSTRAINT renovation_order_details_residential_complex_address_fkey FOREIGN KEY(residential_complex_address_id) REFERENCES residential_complex_addresses(id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE projects ADD CONSTRAINT projects_residential_complex_address_fkey FOREIGN KEY(residential_complex_address_id) REFERENCES residential_complex_addresses(id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE estimates ADD CONSTRAINT estimates_residential_complex_address_fkey FOREIGN KEY(residential_complex_address_id) REFERENCES residential_complex_addresses(id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE inspections ADD CONSTRAINT inspections_residential_complex_address_owner_fkey FOREIGN KEY(residential_complex_address_id,residential_complex_id) REFERENCES residential_complex_addresses(id,residential_complex_id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE design_projects ADD CONSTRAINT design_projects_residential_complex_address_owner_fkey FOREIGN KEY(residential_complex_address_id,residential_complex_id) REFERENCES residential_complex_addresses(id,residential_complex_id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE renovation_order_details ADD CONSTRAINT renovation_order_details_residential_complex_address_owner_fkey FOREIGN KEY(residential_complex_address_id,residential_complex_id) REFERENCES residential_complex_addresses(id,residential_complex_id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE projects ADD CONSTRAINT projects_residential_complex_address_owner_fkey FOREIGN KEY(residential_complex_address_id,residential_complex_id) REFERENCES residential_complex_addresses(id,residential_complex_id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE estimates ADD CONSTRAINT estimates_residential_complex_address_owner_fkey FOREIGN KEY(residential_complex_address_id,residential_complex_id) REFERENCES residential_complex_addresses(id,residential_complex_id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE inspections ADD CONSTRAINT inspections_residential_complex_address_requires_complex CHECK(residential_complex_address_id IS NULL OR residential_complex_id IS NOT NULL);
--> statement-breakpoint
ALTER TABLE design_projects ADD CONSTRAINT design_projects_residential_complex_address_requires_complex CHECK(residential_complex_address_id IS NULL OR residential_complex_id IS NOT NULL);
--> statement-breakpoint
ALTER TABLE renovation_order_details ADD CONSTRAINT renovation_order_details_residential_complex_address_requires_complex CHECK(residential_complex_address_id IS NULL OR residential_complex_id IS NOT NULL);
--> statement-breakpoint
ALTER TABLE projects ADD CONSTRAINT projects_residential_complex_address_requires_complex CHECK(residential_complex_address_id IS NULL OR residential_complex_id IS NOT NULL);
--> statement-breakpoint
ALTER TABLE estimates ADD CONSTRAINT estimates_residential_complex_address_requires_complex CHECK(residential_complex_address_id IS NULL OR residential_complex_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_inspections_residential_complex_address ON inspections(residential_complex_address_id);
--> statement-breakpoint
CREATE INDEX idx_design_projects_residential_complex_address ON design_projects(residential_complex_address_id);
--> statement-breakpoint
CREATE INDEX idx_renovation_order_details_residential_complex_address ON renovation_order_details(residential_complex_address_id);
--> statement-breakpoint
CREATE INDEX idx_projects_residential_complex_address ON projects(residential_complex_address_id);
--> statement-breakpoint
CREATE INDEX idx_estimates_residential_complex_address ON estimates(residential_complex_address_id);
--> statement-breakpoint
CREATE FUNCTION prevent_last_residential_complex_address_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM residential_complex_addresses WHERE residential_complex_id=OLD.residential_complex_id) <= 1 THEN
    RAISE EXCEPTION 'A Residential Complex must retain at least one address';
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER residential_complex_addresses_keep_one BEFORE DELETE ON residential_complex_addresses FOR EACH ROW EXECUTE FUNCTION prevent_last_residential_complex_address_delete();
--> statement-breakpoint
ALTER TABLE residential_complexes DROP COLUMN address;
--> statement-breakpoint
ALTER TABLE residential_complexes DROP COLUMN district;
