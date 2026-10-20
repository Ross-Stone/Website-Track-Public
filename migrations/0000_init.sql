CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "users_email_lowercase" CHECK("users"."email" = lower("users"."email")),
	CONSTRAINT "users_role_valid" CHECK("users"."role" in ('admin', 'writer', 'reader'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);
--> statement-breakpoint
CREATE TABLE `children` (
	`id` text PRIMARY KEY NOT NULL,
	`first_name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `activity_types` (
	`id` text PRIMARY KEY NOT NULL,
	`system_key` text,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`icon` text NOT NULL,
	`colour` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "activity_types_kind_valid" CHECK("activity_types"."kind" in ('point', 'duration'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_types_system_key_unique` ON `activity_types` (`system_key`);
--> statement-breakpoint
CREATE TABLE `activity_fields` (
	`id` text PRIMARY KEY NOT NULL,
	`activity_type_id` text NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`field_type` text NOT NULL,
	`unit` text,
	`decimals` integer,
	`min` real,
	`max` real,
	`max_length` integer,
	`options` text,
	`picker_set` text,
	`show_when` text,
	`required` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`activity_type_id`) REFERENCES `activity_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_fields_type_key_unique` ON `activity_fields` (`activity_type_id`,`key`);
--> statement-breakpoint
CREATE TABLE `child_activity_settings` (
	`child_id` text NOT NULL,
	`activity_type_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`quick_log` integer DEFAULT false NOT NULL,
	`defaults` text DEFAULT '{}' NOT NULL,
	`window_before_min` integer DEFAULT 120 NOT NULL,
	`window_after_min` integer DEFAULT 120 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`child_id`, `activity_type_id`),
	FOREIGN KEY (`child_id`) REFERENCES `children`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`activity_type_id`) REFERENCES `activity_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `schedule_items` (
	`id` text PRIMARY KEY NOT NULL,
	`child_id` text NOT NULL,
	`activity_type_id` text NOT NULL,
	`label` text,
	`start_time` text NOT NULL,
	`end_time` text,
	`days_mask` integer NOT NULL,
	`repeat` text DEFAULT 'weekly' NOT NULL,
	`anchor_date` text,
	`valid_from` text,
	`valid_until` text,
	`auto_confirm` integer DEFAULT false NOT NULL,
	`note` text,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`child_id`) REFERENCES `children`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`activity_type_id`) REFERENCES `activity_types`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "schedule_items_days_mask_valid" CHECK("schedule_items"."days_mask" between 1 and 127)
);
--> statement-breakpoint
CREATE INDEX `schedule_items_child_idx` ON `schedule_items` (`child_id`);
--> statement-breakpoint
CREATE TABLE `schedule_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`child_id` text NOT NULL,
	`schedule_item_id` text NOT NULL,
	`local_date` text NOT NULL,
	`action` text NOT NULL,
	`new_start_time` text,
	`new_end_time` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`child_id`) REFERENCES `children`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`schedule_item_id`) REFERENCES `schedule_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_overrides_item_date_unique` ON `schedule_overrides` (`schedule_item_id`,`local_date`);
--> statement-breakpoint
CREATE INDEX `schedule_overrides_child_date_idx` ON `schedule_overrides` (`child_id`,`local_date`);
--> statement-breakpoint
CREATE TABLE `medicines` (
	`id` text PRIMARY KEY NOT NULL,
	`child_id` text NOT NULL,
	`name` text NOT NULL,
	`dose` real NOT NULL,
	`dose_unit` text DEFAULT 'ml' NOT NULL,
	`min_gap_min` integer NOT NULL,
	`max_per_24h` integer NOT NULL,
	`counts_towards_alternating` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`child_id`) REFERENCES `children`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `entries` (
	`id` text PRIMARY KEY NOT NULL,
	`child_id` text NOT NULL,
	`activity_type_id` text NOT NULL,
	`start_utc` text NOT NULL,
	`end_utc` text,
	`tz` text NOT NULL,
	`local_date` text NOT NULL,
	`values` text DEFAULT '{}' NOT NULL,
	`medicine_id` text,
	`dose` real,
	`dose_unit` text,
	`note` text,
	`schedule_item_id` text,
	`auto_confirmed` integer DEFAULT false NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`child_id`) REFERENCES `children`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`activity_type_id`) REFERENCES `activity_types`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`medicine_id`) REFERENCES `medicines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`schedule_item_id`) REFERENCES `schedule_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `entries_child_date_idx` ON `entries` (`child_id`,`local_date`);
--> statement-breakpoint
CREATE INDEX `entries_child_type_start_idx` ON `entries` (`child_id`,`activity_type_id`,`start_utc`);
--> statement-breakpoint
CREATE INDEX `entries_child_end_idx` ON `entries` (`child_id`,`end_utc`);
--> statement-breakpoint
CREATE UNIQUE INDEX `entries_auto_confirm_unique` ON `entries` (`schedule_item_id`,`local_date`) WHERE auto_confirmed = 1;
--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "sync_state_single_row" CHECK("sync_state"."id" = 1)
);
