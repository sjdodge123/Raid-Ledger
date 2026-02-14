ALTER TABLE "users" ADD COLUMN "display_name" varchar(30);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "onboarding_completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "display_name_length" CHECK ("users"."display_name" IS NULL OR (LENGTH("users"."display_name") >= 2 AND LENGTH("users"."display_name") <= 30));