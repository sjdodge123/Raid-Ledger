ALTER TABLE "guilds" ADD COLUMN "founded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "blizzard_summary_status" varchar(12);--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "blizzard_not_found_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guilds" ADD CONSTRAINT "guilds_blizzard_summary_status_check" CHECK ("guilds"."blizzard_summary_status" IS NULL OR "guilds"."blizzard_summary_status" IN ('ok', 'not_found', 'disbanded', 'error'));