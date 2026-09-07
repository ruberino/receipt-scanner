PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_shopping_list_items` (
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
	CONSTRAINT "shopping_list_items_source_check" CHECK("__new_shopping_list_items"."source" in ('suggested', 'manual', 'ai'))
);
--> statement-breakpoint
INSERT INTO `__new_shopping_list_items`("id", "list_id", "product_id", "name", "quantity_text", "source", "reason", "checked", "position", "created_at") SELECT "id", "list_id", "product_id", "name", "quantity_text", "source", "reason", "checked", "position", "created_at" FROM `shopping_list_items`;--> statement-breakpoint
DROP TABLE `shopping_list_items`;--> statement-breakpoint
ALTER TABLE `__new_shopping_list_items` RENAME TO `shopping_list_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `shopping_list_items_list` ON `shopping_list_items` (`list_id`,`position`);