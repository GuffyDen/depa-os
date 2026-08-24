CREATE TABLE apartment_passports (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  client_id text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  current_published_version_id text,
  cover_attachment_id text,
  custom_note text,
  financial_summary_enabled integer NOT NULL DEFAULT 1,
  excluded_attachment_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  attachment_captions_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at integer,
  published_by_user_id text,
  archived_at integer,
  archived_by_user_id text,
  archive_reason text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CONSTRAINT apartment_passports_project_fkey FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT apartment_passports_client_fkey FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT apartment_passports_cover_fkey FOREIGN KEY(cover_attachment_id) REFERENCES attachments(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT apartment_passports_publisher_fkey FOREIGN KEY(published_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT apartment_passports_archiver_fkey FOREIGN KEY(archived_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT apartment_passports_status_check CHECK(status IN ('DRAFT','READY','PUBLISHED','ARCHIVED')),
  CONSTRAINT apartment_passports_financial_summary_check CHECK(financial_summary_enabled IN (0,1)),
  CONSTRAINT apartment_passports_exclusions_shape_check CHECK(jsonb_typeof(excluded_attachment_ids_json)='array'),
  CONSTRAINT apartment_passports_captions_shape_check CHECK(jsonb_typeof(attachment_captions_json)='object'),
  CONSTRAINT apartment_passports_archive_check CHECK(status<>'ARCHIVED' OR (archived_at IS NOT NULL AND archived_by_user_id IS NOT NULL AND length(trim(archive_reason))>0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX apartment_passports_project_unique ON apartment_passports(project_id);
--> statement-breakpoint
CREATE INDEX idx_apartment_passports_client_status ON apartment_passports(client_id,status,updated_at DESC);
--> statement-breakpoint
CREATE TABLE apartment_passport_sections (
  id text PRIMARY KEY,
  passport_id text NOT NULL,
  section_key text NOT NULL,
  enabled integer NOT NULL DEFAULT 1,
  position integer NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CONSTRAINT apartment_passport_sections_passport_fkey FOREIGN KEY(passport_id) REFERENCES apartment_passports(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT apartment_passport_sections_key_check CHECK(section_key IN ('GENERAL','DESIGN','ESTIMATE','ADDITIONAL_WORKS','PRODUCTION','DAILY_PHOTOS','HIDDEN_WORKS','FINAL_PHOTOS','HANDOVER','DEFECT_HISTORY','DOCUMENTS','WARRANTY')),
  CONSTRAINT apartment_passport_sections_enabled_check CHECK(enabled IN (0,1)),
  CONSTRAINT apartment_passport_sections_position_check CHECK(position>=0),
  CONSTRAINT apartment_passport_sections_mandatory_check CHECK(section_key NOT IN ('GENERAL','HANDOVER') OR enabled=1),
  CONSTRAINT apartment_passport_sections_unique UNIQUE(passport_id,section_key),
  CONSTRAINT apartment_passport_sections_position_unique UNIQUE(passport_id,position)
);
--> statement-breakpoint
CREATE TABLE apartment_passport_versions (
  id text PRIMARY KEY,
  passport_id text NOT NULL,
  version_number integer NOT NULL,
  snapshot_json jsonb NOT NULL,
  source_manifest_json jsonb NOT NULL,
  source_hash text NOT NULL,
  release_note text,
  published_by_user_id text NOT NULL,
  published_at integer NOT NULL,
  created_at integer NOT NULL,
  CONSTRAINT apartment_passport_versions_passport_fkey FOREIGN KEY(passport_id) REFERENCES apartment_passports(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT apartment_passport_versions_publisher_fkey FOREIGN KEY(published_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT apartment_passport_versions_number_check CHECK(version_number>0),
  CONSTRAINT apartment_passport_versions_number_unique UNIQUE(passport_id,version_number),
  CONSTRAINT apartment_passport_versions_identity_unique UNIQUE(id,passport_id)
);
--> statement-breakpoint
CREATE INDEX idx_apartment_passport_versions_passport_published ON apartment_passport_versions(passport_id,published_at DESC);
--> statement-breakpoint
ALTER TABLE apartment_passports ADD CONSTRAINT apartment_passports_current_version_same_passport_fkey FOREIGN KEY(current_published_version_id,id) REFERENCES apartment_passport_versions(id,passport_id) ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE TABLE apartment_passport_version_attachments (
  id text PRIMARY KEY,
  passport_version_id text NOT NULL,
  attachment_id text NOT NULL,
  section_key text NOT NULL,
  position integer NOT NULL,
  caption text,
  display_name_snapshot text NOT NULL,
  mime_type_snapshot text NOT NULL,
  size_bytes_snapshot integer NOT NULL,
  created_at integer NOT NULL,
  CONSTRAINT apartment_passport_version_attachments_version_fkey FOREIGN KEY(passport_version_id) REFERENCES apartment_passport_versions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT apartment_passport_version_attachments_attachment_fkey FOREIGN KEY(attachment_id) REFERENCES attachments(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT apartment_passport_version_attachments_key_check CHECK(section_key IN ('DESIGN','ESTIMATE','ADDITIONAL_WORKS','DAILY_PHOTOS','HIDDEN_WORKS','FINAL_PHOTOS','DEFECT_HISTORY','DOCUMENTS')),
  CONSTRAINT apartment_passport_version_attachments_position_check CHECK(position>=0),
  CONSTRAINT apartment_passport_version_attachment_unique UNIQUE(passport_version_id,attachment_id,section_key)
);
--> statement-breakpoint
CREATE INDEX idx_apartment_passport_version_attachments_page ON apartment_passport_version_attachments(passport_version_id,section_key,position,id);
--> statement-breakpoint
CREATE TABLE apartment_passport_events (
  id text PRIMARY KEY,
  passport_id text NOT NULL,
  passport_version_id text,
  project_id text NOT NULL,
  type text NOT NULL,
  employee_user_id text NOT NULL,
  comment text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at integer NOT NULL,
  CONSTRAINT apartment_passport_events_passport_fkey FOREIGN KEY(passport_id) REFERENCES apartment_passports(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT apartment_passport_events_version_fkey FOREIGN KEY(passport_version_id) REFERENCES apartment_passport_versions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT apartment_passport_events_project_fkey FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT apartment_passport_events_employee_fkey FOREIGN KEY(employee_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT apartment_passport_events_type_check CHECK(type IN ('CREATED','READY','PUBLISHED','VERSION_CREATED','REPUBLISHED','ARCHIVED','RESTORED','SECTION_CHANGED','CUSTOM_NOTE_CHANGED','COVER_CHANGED'))
);
--> statement-breakpoint
CREATE INDEX idx_apartment_passport_events_passport_time ON apartment_passport_events(passport_id,occurred_at DESC);
--> statement-breakpoint
CREATE FUNCTION reject_published_passport_version_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Published Apartment Passport versions are immutable'; END $$;
--> statement-breakpoint
CREATE TRIGGER apartment_passport_versions_immutable BEFORE UPDATE OR DELETE ON apartment_passport_versions FOR EACH ROW EXECUTE FUNCTION reject_published_passport_version_mutation();
--> statement-breakpoint
CREATE TRIGGER apartment_passport_version_attachments_immutable BEFORE UPDATE OR DELETE ON apartment_passport_version_attachments FOR EACH ROW EXECUTE FUNCTION reject_published_passport_version_mutation();
--> statement-breakpoint
CREATE FUNCTION reject_published_passport_attachment_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT 1 FROM apartment_passport_version_attachments WHERE attachment_id=OLD.id) THEN RAISE EXCEPTION 'Attachment is retained by a published Apartment Passport'; END IF; RETURN OLD; END $$;
--> statement-breakpoint
CREATE TRIGGER attachments_passport_retention BEFORE DELETE ON attachments FOR EACH ROW EXECUTE FUNCTION reject_published_passport_attachment_delete();
