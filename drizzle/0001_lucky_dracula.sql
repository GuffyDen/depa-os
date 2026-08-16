CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_actor_time` ON `audit_logs` (`actor_user_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_entity_time` ON `audit_logs` (`entity_type`,`entity_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `auth_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier_hash` text NOT NULL,
	`attempted_at` integer NOT NULL,
	`succeeded` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_auth_attempts_identifier_time` ON `auth_attempts` (`identifier_hash`,`attempted_at`);--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`user_agent` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_auth_sessions_token_hash` ON `auth_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_auth_sessions_user_expires` ON `auth_sessions` (`user_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `user_permissions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`permission` text NOT NULL,
	`scope` text DEFAULT 'COMPANY' NOT NULL,
	`allowed` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_permission_scope` ON `user_permissions` (`user_id`,`permission`,`scope`);--> statement-breakpoint
CREATE TABLE `user_project_access` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`access_level` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_project_access` ON `user_project_access` (`user_id`,`project_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`auth_provider` text DEFAULT 'LOCAL' NOT NULL,
	`external_auth_id` text,
	`email` text,
	`username` text NOT NULL,
	`username_normalized` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`employee_id` text,
	`client_id` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`is_protected_owner` integer DEFAULT false NOT NULL,
	`password_hash` text,
	`password_salt` text,
	`password_iterations` integer,
	`password_changed_at` integer,
	`last_login_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_username_normalized` ON `users` (`username_normalized`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_external_auth_id` ON `users` (`external_auth_id`);--> statement-breakpoint
CREATE INDEX `idx_users_employee` ON `users` (`employee_id`);--> statement-breakpoint
CREATE INDEX `idx_users_role_status` ON `users` (`role`,`status`);--> statement-breakpoint
ALTER TABLE `daily_reports` ADD `created_by_user_id` text;--> statement-breakpoint
CREATE INDEX `idx_daily_report_creator` ON `daily_reports` (`created_by_user_id`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `created_by_user_id` text;--> statement-breakpoint
CREATE INDEX `idx_tasks_creator` ON `tasks` (`created_by_user_id`);
--> statement-breakpoint
CREATE TRIGGER `protect_owner_delete`
BEFORE DELETE ON `users`
WHEN OLD.`is_protected_owner` = 1
BEGIN
	SELECT RAISE(ABORT, 'Protected Owner cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `protect_owner_identity_update`
BEFORE UPDATE OF `role`, `status`, `is_protected_owner`, `username`, `username_normalized`, `employee_id` ON `users`
WHEN OLD.`is_protected_owner` = 1 AND (
	NEW.`role` <> OLD.`role` OR
	NEW.`status` <> OLD.`status` OR
	NEW.`is_protected_owner` <> OLD.`is_protected_owner` OR
	NEW.`username` <> OLD.`username` OR
	NEW.`username_normalized` <> OLD.`username_normalized` OR
	NEW.`employee_id` <> OLD.`employee_id`
)
BEGIN
	SELECT RAISE(ABORT, 'Protected Owner identity cannot be changed');
END;
--> statement-breakpoint
CREATE TRIGGER `audit_logs_immutable_update`
BEFORE UPDATE ON `audit_logs`
BEGIN
	SELECT RAISE(ABORT, 'Audit Log is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `audit_logs_immutable_delete`
BEFORE DELETE ON `audit_logs`
BEGIN
	SELECT RAISE(ABORT, 'Audit Log is immutable');
END;
--> statement-breakpoint
PRAGMA optimize;
