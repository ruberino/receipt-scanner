CREATE TABLE `shopping_list_dismissals` (
	`list_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`list_id`, `product_id`),
	FOREIGN KEY (`list_id`) REFERENCES `shopping_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
