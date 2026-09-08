ALTER TABLE `products` ADD `parent_id` integer REFERENCES products(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `products_parent` ON `products` (`parent_id`);