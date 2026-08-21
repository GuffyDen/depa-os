CREATE SEQUENCE depa_order_number_seq START WITH 1;
--> statement-breakpoint
SELECT setval('depa_order_number_seq',GREATEST(COALESCE((SELECT MAX(NULLIF(regexp_replace(number,'[^0-9]+','','g'),'')::bigint) FROM orders),0),1),EXISTS(SELECT 1 FROM orders));
--> statement-breakpoint
ALTER TABLE orders ADD COLUMN responsible_user_id text;
--> statement-breakpoint
ALTER TABLE orders ADD COLUMN scheduled_at integer;
--> statement-breakpoint
ALTER TABLE orders ADD COLUMN started_at integer;
--> statement-breakpoint
ALTER TABLE orders ADD COLUMN completed_at integer;
--> statement-breakpoint
ALTER TABLE orders ADD COLUMN cancelled_at integer;
--> statement-breakpoint
ALTER TABLE orders ADD COLUMN comment text;
--> statement-breakpoint
ALTER TABLE orders ADD COLUMN internal_comment text;
--> statement-breakpoint
ALTER TABLE orders ADD COLUMN created_by_user_id text;
--> statement-breakpoint
UPDATE orders SET type=CASE WHEN type IN ('INSPECTION','ACCEPTANCE') THEN 'INSPECTION' ELSE 'RENOVATION' END,status=CASE WHEN status IN ('NEW','SCHEDULED','IN_PROGRESS','COMPLETED','CANCELLED') THEN status ELSE 'NEW' END,responsible_user_id=COALESCE((SELECT id FROM users WHERE role='OWNER' AND status='ACTIVE' ORDER BY created_at LIMIT 1),(SELECT id FROM users ORDER BY created_at LIMIT 1)),created_by_user_id=COALESCE((SELECT id FROM users WHERE role='OWNER' AND status='ACTIVE' ORDER BY created_at LIMIT 1),(SELECT id FROM users ORDER BY created_at LIMIT 1));
--> statement-breakpoint
ALTER TABLE orders ALTER COLUMN responsible_user_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE orders ALTER COLUMN created_by_user_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE orders ADD CONSTRAINT orders_number_unique UNIQUE(number);
--> statement-breakpoint
ALTER TABLE orders ADD CONSTRAINT orders_type_check CHECK(type IN ('INSPECTION','RENOVATION'));
--> statement-breakpoint
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK(status IN ('NEW','SCHEDULED','IN_PROGRESS','COMPLETED','CANCELLED'));
--> statement-breakpoint
ALTER TABLE orders ADD CONSTRAINT orders_amount_check CHECK(amount_kopecks>=0);
--> statement-breakpoint
ALTER TABLE orders ADD CONSTRAINT orders_responsible_user_id_fkey FOREIGN KEY(responsible_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE orders ADD CONSTRAINT orders_created_by_user_id_fkey FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
CREATE TABLE inspections(id text PRIMARY KEY,order_id text NOT NULL,residential_complex text,address text NOT NULL,apartment_number text NOT NULL,area_sqm numeric(10,2),scheduled_at integer NOT NULL,inspector_user_id text NOT NULL,result_comment text,created_at integer NOT NULL,updated_at integer NOT NULL,CONSTRAINT inspections_order_unique UNIQUE(order_id),CONSTRAINT inspections_order_id_fkey FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE RESTRICT ON UPDATE CASCADE,CONSTRAINT inspections_inspector_user_id_fkey FOREIGN KEY(inspector_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,CONSTRAINT inspections_area_check CHECK(area_sqm IS NULL OR area_sqm>0));
--> statement-breakpoint
CREATE TABLE inspection_defects(id text PRIMARY KEY,inspection_id text NOT NULL,room text NOT NULL,category text NOT NULL,description text NOT NULL,severity text NOT NULL,status text NOT NULL DEFAULT 'OPEN',created_by_user_id text NOT NULL,created_at integer NOT NULL,updated_at integer NOT NULL,CONSTRAINT inspection_defects_inspection_id_fkey FOREIGN KEY(inspection_id) REFERENCES inspections(id) ON DELETE RESTRICT ON UPDATE CASCADE,CONSTRAINT inspection_defects_created_by_user_id_fkey FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,CONSTRAINT inspection_defects_category_check CHECK(category IN ('WALLS','FLOOR','CEILING','WINDOWS','DOORS','ELECTRICAL','PLUMBING','VENTILATION','FINISHING','OTHER')),CONSTRAINT inspection_defects_severity_check CHECK(severity IN ('LOW','MEDIUM','HIGH')),CONSTRAINT inspection_defects_status_check CHECK(status IN ('OPEN','RESOLVED')));
--> statement-breakpoint
CREATE INDEX idx_orders_client_created ON orders(client_id,created_at DESC);
--> statement-breakpoint
CREATE INDEX idx_orders_responsible_scheduled ON orders(responsible_user_id,scheduled_at);
--> statement-breakpoint
CREATE INDEX idx_orders_status_scheduled ON orders(status,scheduled_at);
--> statement-breakpoint
CREATE INDEX idx_inspections_scheduled ON inspections(scheduled_at);
--> statement-breakpoint
CREATE INDEX idx_inspection_defects_inspection_created ON inspection_defects(inspection_id,created_at DESC);
--> statement-breakpoint
CREATE INDEX idx_attachments_inspection_entity ON attachments(entity_type,entity_id) WHERE category='INSPECTION' AND deleted_at IS NULL;
