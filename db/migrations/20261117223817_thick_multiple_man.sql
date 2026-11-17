CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`storage_path` text NOT NULL,
	`name` text NOT NULL,
	`true_w` integer NOT NULL,
	`true_h` integer NOT NULL,
	`meta` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `assets_user_id_idx` ON `assets` (`user_id`);