CREATE TABLE `shopping_list_proposals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`list_id` integer NOT NULL,
	`model` text NOT NULL,
	`prompt_version` integer NOT NULL,
	`items_json` text NOT NULL,
	`raw_response` text NOT NULL,
	`prompt_tokens` integer NOT NULL,
	`completion_tokens` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`accepted_json` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `shopping_lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `shopping_list_proposals_list` ON `shopping_list_proposals` (`list_id`);