ALTER TABLE `cashboxes` ADD `owner_user_id` text;
--> statement-breakpoint
ALTER TABLE `cashboxes` ADD `status` text DEFAULT 'ACTIVE' NOT NULL;
--> statement-breakpoint
ALTER TABLE `cashboxes` ADD `balance_kopecks` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `cashboxes` ADD `deactivated_at` integer;
--> statement-breakpoint
ALTER TABLE `cashboxes` ADD `deactivated_by_user_id` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_cashboxes_owner_user` ON `cashboxes` (`owner_user_id`);
--> statement-breakpoint
CREATE INDEX `idx_cashboxes_status` ON `cashboxes` (`status`);
--> statement-breakpoint
UPDATE `cashboxes`
SET `status` = 'INACTIVE', `is_active` = 0, `updated_at` = CAST(strftime('%s','now') AS integer)
WHERE `owner_employee_id` IS NULL OR lower(`name`) LIKE '%общ%';
--> statement-breakpoint
ALTER TABLE `financial_transactions` ADD `expense_type` text;
--> statement-breakpoint
ALTER TABLE `financial_transactions` ADD `original_transaction_id` text;
--> statement-breakpoint
ALTER TABLE `financial_transactions` ADD `source` text;
--> statement-breakpoint
CREATE INDEX `idx_transactions_destination_date` ON `financial_transactions` (`destination_cashbox_id`,`transaction_date`);
--> statement-breakpoint
CREATE INDEX `idx_transactions_original` ON `financial_transactions` (`original_transaction_id`);
--> statement-breakpoint
ALTER TABLE `attachments` ADD `content_base64` text;
