CREATE TABLE `product_aliases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`alias_normalized` text NOT NULL,
	`product_id` integer NOT NULL,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "product_aliases_source_check" CHECK("product_aliases"."source" in ('llm', 'user'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_aliases_alias_normalized_unique` ON `product_aliases` (`alias_normalized`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`name_normalized` text NOT NULL,
	`category` text,
	`suppressed` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_name_normalized_unique` ON `products` (`name_normalized`);--> statement-breakpoint
CREATE TABLE `receipt_images` (
	`receipt_id` integer PRIMARY KEY NOT NULL,
	`mime_type` text NOT NULL,
	`bytes` blob NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`sha256` text NOT NULL,
	FOREIGN KEY (`receipt_id`) REFERENCES `receipts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `receipt_images_sha256_unique` ON `receipt_images` (`sha256`);--> statement-breakpoint
CREATE TABLE `receipt_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`receipt_id` integer NOT NULL,
	`line_no` integer NOT NULL,
	`kind` text NOT NULL,
	`raw_text` text NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit` text,
	`unit_price_ore` integer,
	`total_ore` integer NOT NULL,
	`product_id` integer,
	`match_source` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`receipt_id`) REFERENCES `receipts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "receipt_lines_kind_check" CHECK("receipt_lines"."kind" in ('item', 'discount', 'deposit', 'other')),
	CONSTRAINT "receipt_lines_unit_check" CHECK("receipt_lines"."unit" is null or "receipt_lines"."unit" in ('stk', 'kg', 'l')),
	CONSTRAINT "receipt_lines_match_source_check" CHECK("receipt_lines"."match_source" is null or "receipt_lines"."match_source" in ('alias', 'llm', 'user'))
);
--> statement-breakpoint
CREATE INDEX `receipt_lines_receipt` ON `receipt_lines` (`receipt_id`,`line_no`);--> statement-breakpoint
CREATE INDEX `receipt_lines_product` ON `receipt_lines` (`product_id`);--> statement-breakpoint
CREATE TABLE `receipts` (
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
	CONSTRAINT "receipts_status_check" CHECK("receipts"."status" in ('pending', 'processing', 'done', 'failed'))
);
--> statement-breakpoint
CREATE TABLE `shopping_list_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`list_id` integer NOT NULL,
	`product_id` integer,
	`name` text NOT NULL,
	`quantity_text` text,
	`source` text NOT NULL,
	`reason` text,
	`checked` integer DEFAULT 0 NOT NULL,
	`position` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `shopping_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "shopping_list_items_source_check" CHECK("shopping_list_items"."source" in ('suggested', 'manual'))
);
--> statement-breakpoint
CREATE INDEX `shopping_list_items_list` ON `shopping_list_items` (`list_id`,`position`);--> statement-breakpoint
CREATE TABLE `shopping_lists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`week_start` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	CONSTRAINT "shopping_lists_status_check" CHECK("shopping_lists"."status" in ('open', 'done'))
);
