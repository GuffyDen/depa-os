ALTER TABLE inspections ADD COLUMN scheduled_start_at integer;
--> statement-breakpoint
ALTER TABLE inspections ADD COLUMN scheduled_end_at integer;
--> statement-breakpoint
UPDATE inspections
SET scheduled_start_at=scheduled_at,
    scheduled_end_at=scheduled_at+5400
WHERE scheduled_start_at IS NULL OR scheduled_end_at IS NULL;
--> statement-breakpoint
ALTER TABLE inspections ALTER COLUMN scheduled_start_at SET NOT NULL;
--> statement-breakpoint
ALTER TABLE inspections ALTER COLUMN scheduled_end_at SET NOT NULL;
--> statement-breakpoint
ALTER TABLE inspections ADD CONSTRAINT inspections_schedule_range_check CHECK(scheduled_end_at>scheduled_start_at);
--> statement-breakpoint
CREATE INDEX idx_inspections_inspector_schedule ON inspections(inspector_user_id,scheduled_start_at,scheduled_end_at);
