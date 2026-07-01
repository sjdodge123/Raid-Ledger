ALTER TABLE "games" ADD COLUMN "website_url" text;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "is_free_to_play" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "install_size_bytes" bigint;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "download_size_bytes" bigint;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "install_size_source" varchar(20);--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "install_size_updated_at" timestamp;