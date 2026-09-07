PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_receipts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`status` text NOT NULL,
	`store_name` text,
	`purchased_at` text,
	`total_ore` integer,
	`currency` text DEFAULT 'NOK' NOT NULL,
	`warnings_json` text DEFAULT '[]' NOT NULL,
	`extraction_json` text,
	`raw_response` text,
	`prompt_version` integer,
	`model` text,
	`error_message` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`possible_duplicate_of` integer,
	`reviewed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`possible_duplicate_of`) REFERENCES `receipts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "receipts_status_check" CHECK("__new_receipts"."status" in ('uploaded', 'pending', 'processing', 'done', 'failed'))
);
--> statement-breakpoint
INSERT INTO `__new_receipts`("id", "status", "store_name", "purchased_at", "total_ore", "currency", "warnings_json", "extraction_json", "raw_response", "prompt_version", "model", "error_message", "attempts", "possible_duplicate_of", "reviewed_at", "created_at", "updated_at") SELECT "id", "status", "store_name", "purchased_at", "total_ore", "currency", "warnings_json", "extraction_json", "raw_response", "prompt_version", "model", "error_message", "attempts", "possible_duplicate_of", "reviewed_at", "created_at", "updated_at" FROM `receipts`;--> statement-breakpoint
DROP TABLE `receipts`;--> statement-breakpoint
ALTER TABLE `__new_receipts` RENAME TO `receipts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;