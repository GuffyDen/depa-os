CREATE TABLE `additional_work_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`additional_work_id` text NOT NULL,
	`project_id` text NOT NULL,
	`version` integer NOT NULL,
	`title` text NOT NULL,
	`amount_kopecks` integer NOT NULL,
	`schedule_delta_days` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`approved_by_client_id` text,
	`approved_by_user_id` text,
	`approved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_additional_work_version` ON `additional_work_versions` (`additional_work_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_additional_work_project` ON `additional_work_versions` (`project_id`);--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text,
	`project_id` text,
	`storage_key` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_attachments_transaction` ON `attachments` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `idx_attachments_project` ON `attachments` (`project_id`);--> statement-breakpoint
CREATE TABLE `cashboxes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`owner_employee_id` text,
	`currency` text DEFAULT 'RUB' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`contacts_json` text,
	`source` text,
	`comment` text,
	`owner_employee_id` text,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_clients_phone` ON `clients` (`phone`);--> statement-breakpoint
CREATE INDEX `idx_clients_owner` ON `clients` (`owner_employee_id`);--> statement-breakpoint
CREATE TABLE `contractor_agreements` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`contractor_id` text NOT NULL,
	`work_title` text NOT NULL,
	`agreed_amount_kopecks` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_agreements_project_contractor` ON `contractor_agreements` (`project_id`,`contractor_id`);--> statement-breakpoint
CREATE TABLE `contractors` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`specialization` text NOT NULL,
	`phone` text,
	`contacts_json` text,
	`comment` text,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_contractors_specialization_status` ON `contractors` (`specialization`,`status`);--> statement-breakpoint
CREATE TABLE `daily_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`report_date` integer NOT NULL,
	`author_employee_id` text NOT NULL,
	`workers_json` text,
	`work_completed` text NOT NULL,
	`comment` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_daily_report_project_date` ON `daily_reports` (`project_id`,`report_date`);--> statement-breakpoint
CREATE TABLE `employees` (
	`id` text PRIMARY KEY NOT NULL,
	`full_name` text NOT NULL,
	`phone` text,
	`position` text,
	`contacts_json` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`permissions_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_employees_status` ON `employees` (`status`);--> statement-breakpoint
CREATE TABLE `estimate_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`version` integer NOT NULL,
	`total_kopecks` integer NOT NULL,
	`change_reason` text,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_estimate_project_version` ON `estimate_versions` (`project_id`,`version`);--> statement-breakpoint
CREATE TABLE `financial_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`amount_kopecks` integer NOT NULL,
	`transaction_date` integer NOT NULL,
	`type` text NOT NULL,
	`author_user_id` text NOT NULL,
	`cashbox_id` text NOT NULL,
	`destination_cashbox_id` text,
	`client_id` text,
	`project_id` text,
	`order_id` text,
	`category` text NOT NULL,
	`subcategory` text,
	`purpose` text,
	`title` text NOT NULL,
	`comment` text,
	`show_to_client` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_transactions_cashbox_date` ON `financial_transactions` (`cashbox_id`,`transaction_date`);--> statement-breakpoint
CREATE INDEX `idx_transactions_project_date` ON `financial_transactions` (`project_id`,`transaction_date`);--> statement-breakpoint
CREATE INDEX `idx_transactions_client_purpose` ON `financial_transactions` (`client_id`,`purpose`);--> statement-breakpoint
CREATE TABLE `leads` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`source` text NOT NULL,
	`owner_employee_id` text,
	`status` text NOT NULL,
	`notes` text,
	`next_action` text,
	`next_contact_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_leads_status_next_contact` ON `leads` (`status`,`next_contact_at`);--> statement-breakpoint
CREATE INDEX `idx_leads_client` ON `leads` (`client_id`);--> statement-breakpoint
CREATE TABLE `obligations` (
	`id` text PRIMARY KEY NOT NULL,
	`direction` text NOT NULL,
	`counterparty_type` text NOT NULL,
	`counterparty_id` text NOT NULL,
	`project_id` text,
	`amount_kopecks` integer NOT NULL,
	`paid_kopecks` integer DEFAULT 0 NOT NULL,
	`due_date` integer,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_obligations_status_due` ON `obligations` (`status`,`due_date`);--> statement-breakpoint
CREATE INDEX `idx_obligations_counterparty` ON `obligations` (`counterparty_type`,`counterparty_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`client_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`amount_kopecks` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_orders_number` ON `orders` (`number`);--> statement-breakpoint
CREATE INDEX `idx_orders_client` ON `orders` (`client_id`);--> statement-breakpoint
CREATE TABLE `project_delays` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`stage_id` text,
	`reason` text NOT NULL,
	`start_date` integer NOT NULL,
	`end_date` integer,
	`days` integer NOT NULL,
	`comment` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_delays_project_start` ON `project_delays` (`project_id`,`start_date`);--> statement-breakpoint
CREATE TABLE `project_stages` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`planned_start` integer,
	`planned_end` integer,
	`actual_start` integer,
	`actual_end` integer,
	`status` text NOT NULL,
	`responsible_employee_id` text,
	`sort_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_stages_project_order` ON `project_stages` (`project_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`client_id` text NOT NULL,
	`name` text NOT NULL,
	`residential_complex` text,
	`address` text,
	`apartment` text,
	`manager_employee_id` text,
	`foreman_employee_id` text,
	`status` text NOT NULL,
	`start_date` integer,
	`planned_end_date` integer,
	`forecast_end_date` integer,
	`actual_end_date` integer,
	`contract_amount_kopecks` integer NOT NULL,
	`comment` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_projects_status_manager` ON `projects` (`status`,`manager_employee_id`);--> statement-breakpoint
CREATE INDEX `idx_projects_client` ON `projects` (`client_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`assignee_employee_id` text,
	`project_id` text,
	`client_id` text,
	`lead_id` text,
	`deadline` integer,
	`status` text NOT NULL,
	`comment` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_assignee_status_deadline` ON `tasks` (`assignee_employee_id`,`status`,`deadline`);--> statement-breakpoint
CREATE INDEX `idx_tasks_project` ON `tasks` (`project_id`);--> statement-breakpoint
CREATE TABLE `transaction_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`project_id` text NOT NULL,
	`order_id` text,
	`amount_kopecks` integer NOT NULL,
	`purpose` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_allocations_transaction` ON `transaction_allocations` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `idx_allocations_project` ON `transaction_allocations` (`project_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`external_auth_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`employee_id` text,
	`client_id` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`is_protected_owner` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_external_auth_id` ON `users` (`external_auth_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_email` ON `users` (`email`);